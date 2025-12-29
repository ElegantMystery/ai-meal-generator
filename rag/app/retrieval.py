import json
from typing import Any, Dict, List, Optional
from .db import get_conn
from .config import RETRIEVAL_K

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

def retrieve_candidates(store: str, query_vec: List[float], k: int = RETRIEVAL_K) -> List[Dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 1) Retrieve top-K items by item_embeddings
            cur.execute("""
              SELECT i.id, i.name, i.price, i.unit_size, i.category_path, i.image_url
              FROM items i
              INNER JOIN item_embeddings ie ON i.id = ie.item_id
              WHERE i.store ILIKE %s
              ORDER BY ie.embedding <=> %s::vector
              LIMIT %s
            """, (store, query_vec, k))
            items = cur.fetchall()

            if not items:
                return []

            item_ids = [row["id"] for row in items]

            # 2) Fetch nutrition JSON for these items
            cur.execute("""
              SELECT item_id, nutrition
              FROM item_nutrition
              WHERE item_id = ANY(%s)
            """, (item_ids,))
            nutrition_rows = cur.fetchall()
            nutrition_by_id = {r["item_id"]: r["nutrition"] for r in nutrition_rows}

            # 3) Fetch ingredients JSON for these items
            cur.execute("""
              SELECT item_id, ingredients
              FROM item_ingredients
              WHERE item_id = ANY(%s)
            """, (item_ids,))
            ingredients_rows = cur.fetchall()
            ingredients_by_id = {r["item_id"]: r["ingredients"] for r in ingredients_rows}

            # 4) Merge into enriched candidate objects
            enriched: List[Dict[str, Any]] = []
            for it in items:
                iid = it["id"]

                nutrition_json = nutrition_by_id.get(iid)
                ingredients_json = ingredients_by_id.get(iid)

                enriched.append({
                    "id": iid,
                    "name": it["name"],
                    "price": it.get("price"),
                    "unit_size": it.get("unit_size"),
                    "category_path": it.get("category_path"),
                    "image_url": it.get("image_url"),

                    # Enriched fields (compact to keep prompt small)
                    "nutrition": _compact_nutrition(nutrition_json),
                    "ingredients": _compact_ingredients(ingredients_json),

                    # Optional: keep raw JSON too (usually OFF to avoid prompt bloat)
                    # "nutrition_raw": nutrition_json,
                    # "ingredients_raw": ingredients_json,
                })

            return enriched

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
