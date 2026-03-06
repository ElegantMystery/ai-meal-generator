import json
import logging
from typing import Any, Dict, List, Optional
from .db import get_conn

logger = logging.getLogger(__name__)

def fetch_items_missing_embeddings(store: Optional[str], limit: int) -> List[Dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            if store:
                cur.execute("""
                  SELECT i.id, i.store, i.name, i.category_path, i.unit_size, i.price, i.tags_json
                  FROM items i
                  LEFT JOIN item_embeddings ie ON i.id = ie.item_id
                  WHERE i.store ILIKE %s AND ie.item_id IS NULL
                  ORDER BY i.id
                  LIMIT %s
                """, (store, limit))
            else:
                cur.execute("""
                  SELECT i.id, i.store, i.name, i.category_path, i.unit_size, i.price, i.tags_json
                  FROM items i
                  LEFT JOIN item_embeddings ie ON i.id = ie.item_id
                  WHERE ie.item_id IS NULL
                  ORDER BY i.id
                  LIMIT %s
                """, (limit,))
            return cur.fetchall()

def upsert_item_embeddings(rows: List[Dict[str, Any]], vectors: List[List[float]]) -> int:
    updated = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            for r, v in zip(rows, vectors):
                cur.execute("""
                  INSERT INTO item_embeddings (item_id, embedding, updated_at)
                  VALUES (%s, %s, CURRENT_TIMESTAMP)
                  ON CONFLICT (item_id) DO UPDATE
                  SET embedding = EXCLUDED.embedding, updated_at = CURRENT_TIMESTAMP
                """, (r["id"], v))
                updated += 1
        conn.commit()
    return updated

def _compact_nutrition(nutrition_json: Dict[str, Any] | str | None) -> Dict[str, Any] | None:
    """
    nutrition_json can be:
    - A JSON string: '{"parsed": {...}, "raw": "..."}'
    - A dict: {"parsed": {...}, "raw": "..."}
    - None
    """
    if not nutrition_json:
        return None
    
    # Parse JSON string if needed
    if isinstance(nutrition_json, str):
        try:
            nutrition_json = json.loads(nutrition_json)
        except (json.JSONDecodeError, TypeError):
            return None
    
    if not isinstance(nutrition_json, dict):
        return None

    parsed = nutrition_json.get("parsed")
    if not isinstance(parsed, dict):
        return None

    # Keep only fields that help planning/filtering; avoid giant raw text
    return {
        "serving_count": parsed.get("serving_count"),
        "serving_size_text": parsed.get("serving_size_text"),
        "serving_size_grams": parsed.get("serving_size_grams"),
        "calories": parsed.get("calories"),
        "protein_g": parsed.get("protein_g"),
        "total_fat_g": parsed.get("total_fat_g"),
        "total_carbohydrate_g": parsed.get("total_carbohydrate_g"),
        "dietary_fiber_g": parsed.get("dietary_fiber_g"),
        "total_sugars_g": parsed.get("total_sugars_g"),
        "sodium_mg": parsed.get("sodium_mg"),
        "cholesterol_mg": parsed.get("cholesterol_mg"),
        "saturated_fat_g": parsed.get("saturated_fat_g"),
    }

def _compact_ingredients(ingredients_json: Dict[str, Any] | str | None) -> Dict[str, Any] | None:
    """
    ingredients_json can be:
    - A JSON string: '{"parsed": {...}, "raw": "..."}'
    - A dict: {"parsed": {...}, "raw": "..."}
    - None
    """
    if not ingredients_json:
        return None
    
    # Parse JSON string if needed
    if isinstance(ingredients_json, str):
        try:
            ingredients_json = json.loads(ingredients_json)
        except (json.JSONDecodeError, TypeError):
            return None
    
    if not isinstance(ingredients_json, dict):
        return None

    parsed = ingredients_json.get("parsed")
    if not isinstance(parsed, dict):
        return None

    # Prefer ingredients_raw for a simple string; also keep a small list of names
    raw_text = parsed.get("ingredients_raw") or ingredients_json.get("raw")

    names: List[str] = []
    lst = parsed.get("ingredients_list")
    if isinstance(lst, list):
        for x in lst[:30]:  # cap to avoid prompt bloat
            if isinstance(x, dict) and x.get("name"):
                names.append(str(x["name"]))

    return {
        "ingredients_raw": raw_text,
        "ingredients_names": names,  # compact list
        "ingredients_count": parsed.get("ingredients_count"),
    }

def _fetch_by_category(cur, store: str, category_keyword: str, limit: int) -> List[Dict[str, Any]]:
    """Fetch items whose category_path contains the given keyword (case-insensitive)."""
    cur.execute("""
      SELECT i.id, i.name, i.price, i.unit_size, i.category_path, i.image_url
      FROM items i
      INNER JOIN item_embeddings ie ON i.id = ie.item_id
      WHERE i.store ILIKE %s AND i.category_path ILIKE %s
      ORDER BY RANDOM()
      LIMIT %s
    """, (store, f"%{category_keyword}%", limit))
    return cur.fetchall()


# Category quotas for proportional random sampling.
# Order matters: higher-priority categories are listed first so they are not
# crowded out during deduplication.
_CATEGORY_QUOTAS: List[tuple] = [
    ("Fresh Fruits & Veggies > Veggies",        20),
    ("Fresh Fruits & Veggies > Fruits",          10),
    ("Meat, Seafood",                            20),
    ("Dairy & Eggs",                             12),
    ("Cheese",                                    8),
    ("Pastas & Grains",                           8),
    ("Packaged Fish, Meat, Fruit & Veg",          6),
    ("For Baking & Cooking",                      6),
    ("Oils & Vinegars",                           4),
    ("BBQ, Pasta, Simmer",                        4),
    ("Bakery > Sliced Bread",                     4),
    ("Dressing & Seasoning",                      4),
    ("Dip/Spread",                                4),
]
_FILL_LIMIT = 10
_MAX_CANDIDATES = 120


def retrieve_candidates(
    store: str,
    query_vec: Optional[List[float]] = None,  # kept for backward compat; no longer used
) -> List[Dict[str, Any]]:
    """
    Retrieve meal plan candidate items using category-proportional random sampling.

    Each specific category receives a fixed quota drawn via ORDER BY RANDOM(),
    ensuring that every generation run surfaces different items and avoids the
    same crowd-pleasers. No vector similarity search is performed.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 1) Sample from each named category up to its quota
            seen_ids: set = set()
            items: List[Dict[str, Any]] = []

            for category_keyword, quota in _CATEGORY_QUOTAS:
                rows = _fetch_by_category(cur, store, category_keyword, quota)
                for row in rows:
                    if row["id"] not in seen_ids:
                        seen_ids.add(row["id"])
                        items.append(row)

            # 2) Fill remaining capacity with any non-candy/non-frozen category
            remaining = _MAX_CANDIDATES - len(items)
            fill_limit = min(_FILL_LIMIT, remaining)
            if fill_limit > 0:
                # Build an exclusion pattern: items already seen + excluded categories
                cur.execute("""
                  SELECT i.id, i.name, i.price, i.unit_size, i.category_path, i.image_url
                  FROM items i
                  INNER JOIN item_embeddings ie ON i.id = ie.item_id
                  WHERE i.store ILIKE %s
                    AND i.id <> ALL(%s)
                    AND i.category_path NOT ILIKE %s
                    AND i.category_path NOT ILIKE %s
                    AND i.category_path NOT ILIKE %s
                    AND i.category_path NOT ILIKE %s
                    AND i.category_path NOT ILIKE %s
                    AND i.category_path NOT ILIKE %s
                    AND i.category_path NOT ILIKE %s
                  ORDER BY RANDOM()
                  LIMIT %s
                """, (
                    store,
                    list(seen_ids),
                    "%candy%",
                    "%frozen%",
                    "%holiday%",
                    "%gift%",
                    "%flowers%",
                    "%beauty%",
                    "%cleaning%",
                    fill_limit,
                ))
                fill_rows = cur.fetchall()
                for row in fill_rows:
                    if row["id"] not in seen_ids:
                        seen_ids.add(row["id"])
                        items.append(row)

            if not items:
                return []

            item_ids = [row["id"] for row in items]

            # 3) Fetch compact nutrition for these items
            cur.execute("""
              SELECT item_id, nutrition
              FROM item_nutrition
              WHERE item_id = ANY(%s)
            """, (item_ids,))
            nutrition_rows = cur.fetchall()
            nutrition_by_id = {r["item_id"]: r["nutrition"] for r in nutrition_rows}

            # 4) Fetch compact ingredients for these items
            cur.execute("""
              SELECT item_id, ingredients
              FROM item_ingredients
              WHERE item_id = ANY(%s)
            """, (item_ids,))
            ingredients_rows = cur.fetchall()
            ingredients_by_id = {r["item_id"]: r["ingredients"] for r in ingredients_rows}

            # 5) Build enriched candidate objects
            enriched: List[Dict[str, Any]] = []
            for it in items:
                iid = it["id"]
                enriched.append({
                    "id": iid,
                    "name": it["name"],
                    "price": it.get("price"),
                    "unit_size": it.get("unit_size"),
                    "category_path": it.get("category_path"),
                    "image_url": it.get("image_url"),
                    "nutrition": _compact_nutrition(nutrition_by_id.get(iid)),
                    "ingredients": _compact_ingredients(ingredients_by_id.get(iid)),
                })

            return enriched

def retrieve_recipes(limit: int = 25, dietary_restriction: str | None = None) -> List[Dict[str, Any]]:
    """
    Randomly sample recipes from the recipes table to use as dish templates.
    Returns compact dicts with dishName, ingredients, diets, servings, cuisines.

    When dietary_restriction is provided (and not 'none'), filters to recipes
    that match that diet. Falls back to unfiltered random sample if no matches.
    """
    # Normalise: treat the string "none" as no restriction
    diet_filter = dietary_restriction if (dietary_restriction and dietary_restriction.lower() != "none") else None

    def _parse_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        for r in rows:
            ing_names: List[str] = []
            if r.get("ingredients_json"):
                try:
                    ings = json.loads(r["ingredients_json"])
                    ing_names = [i["name"] for i in ings if isinstance(i, dict) and i.get("name")][:15]
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    logger.debug("Could not parse ingredients_json for recipe '%s': %s", r.get("title"), exc)
            result.append({
                "dishName": r["title"],
                "ingredients": ing_names,
                "diets": r.get("diets") or [],
                "cuisines": r.get("cuisines") or [],
                "servings": r.get("servings"),
                "dishTypes": r.get("dish_types") or [],
            })
        return result

    with get_conn() as conn:
        with conn.cursor() as cur:
            if diet_filter:
                cur.execute("""
                  SELECT title, ingredients_json, diets, cuisines, servings, dish_types
                  FROM recipes
                  WHERE diets @> ARRAY[%s]::text[]
                  ORDER BY RANDOM()
                  LIMIT %s
                """, (diet_filter, limit))
                rows = cur.fetchall()
                if rows:
                    return _parse_rows(rows)
                # Fallback: no recipes match the diet filter → use unfiltered sample
                logger.warning(
                    "No recipes found for diet_filter=%r; falling back to unfiltered sample",
                    diet_filter,
                )
            cur.execute("""
              SELECT title, ingredients_json, diets, cuisines, servings, dish_types
              FROM recipes
              ORDER BY RANDOM()
              LIMIT %s
            """, (limit,))
            rows = cur.fetchall()

    return _parse_rows(rows)


def verify_ids(store: str, ids: List[int]) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
              SELECT id FROM items
              WHERE store ILIKE %s AND id = ANY(%s)
            """, (store, ids))
            rows = cur.fetchall()
    return len(rows) == len(set(ids))

def fetch_nutrition_missing_embeddings(store: Optional[str], limit: int) -> List[Dict[str, Any]]:
    """Fetch items with nutrition data that are missing embeddings."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if store:
                cur.execute("""
                  SELECT i.id, i.store, inut.nutrition
                  FROM items i
                  INNER JOIN item_nutrition inut ON i.id = inut.item_id
                  LEFT JOIN item_nutrition_embeddings ine ON i.id = ine.item_id
                  WHERE i.store ILIKE %s 
                    AND inut.nutrition IS NOT NULL 
                    AND inut.nutrition != ''
                    AND ine.item_id IS NULL
                  ORDER BY i.id
                  LIMIT %s
                """, (store, limit))
            else:
                cur.execute("""
                  SELECT i.id, i.store, inut.nutrition
                  FROM items i
                  INNER JOIN item_nutrition inut ON i.id = inut.item_id
                  LEFT JOIN item_nutrition_embeddings ine ON i.id = ine.item_id
                  WHERE inut.nutrition IS NOT NULL 
                    AND inut.nutrition != ''
                    AND ine.item_id IS NULL
                  ORDER BY i.id
                  LIMIT %s
                """, (limit,))
            return cur.fetchall()

def fetch_ingredients_missing_embeddings(store: Optional[str], limit: int) -> List[Dict[str, Any]]:
    """Fetch items with ingredients data that are missing embeddings."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if store:
                cur.execute("""
                  SELECT i.id, i.store, ing.ingredients
                  FROM items i
                  INNER JOIN item_ingredients ing ON i.id = ing.item_id
                  LEFT JOIN item_ingredients_embeddings iie ON i.id = iie.item_id
                  WHERE i.store ILIKE %s 
                    AND ing.ingredients IS NOT NULL 
                    AND ing.ingredients != ''
                    AND iie.item_id IS NULL
                  ORDER BY i.id
                  LIMIT %s
                """, (store, limit))
            else:
                cur.execute("""
                  SELECT i.id, i.store, ing.ingredients
                  FROM items i
                  INNER JOIN item_ingredients ing ON i.id = ing.item_id
                  LEFT JOIN item_ingredients_embeddings iie ON i.id = iie.item_id
                  WHERE ing.ingredients IS NOT NULL 
                    AND ing.ingredients != ''
                    AND iie.item_id IS NULL
                  ORDER BY i.id
                  LIMIT %s
                """, (limit,))
            return cur.fetchall()

def upsert_nutrition_embeddings(rows: List[Dict[str, Any]], vectors: List[List[float]]) -> int:
    """Upsert nutrition embeddings."""
    updated = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            for r, v in zip(rows, vectors):
                cur.execute("""
                  INSERT INTO item_nutrition_embeddings (item_id, embedding, updated_at)
                  VALUES (%s, %s, CURRENT_TIMESTAMP)
                  ON CONFLICT (item_id) DO UPDATE
                  SET embedding = EXCLUDED.embedding, updated_at = CURRENT_TIMESTAMP
                """, (r["id"], v))
                updated += 1
        conn.commit()
    return updated

def upsert_ingredients_embeddings(rows: List[Dict[str, Any]], vectors: List[List[float]]) -> int:
    """Upsert ingredients embeddings."""
    updated = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            for r, v in zip(rows, vectors):
                cur.execute("""
                  INSERT INTO item_ingredients_embeddings (item_id, embedding, updated_at)
                  VALUES (%s, %s, CURRENT_TIMESTAMP)
                  ON CONFLICT (item_id) DO UPDATE
                  SET embedding = EXCLUDED.embedding, updated_at = CURRENT_TIMESTAMP
                """, (r["id"], v))
                updated += 1
        conn.commit()
    return updated
