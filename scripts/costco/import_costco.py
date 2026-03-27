from __future__ import annotations

import json
import os
import psycopg2
import psycopg2.extras

COSTCO_BASE = "https://www.costco.com"

UPSERT_ITEM_SQL = """
INSERT INTO items
  (store, name, external_id, price, unit_size, category_path, image_url, tags_json, raw_json)
VALUES
  (%(store)s, %(name)s, %(external_id)s, %(price)s, %(unit_size)s, %(category_path)s,
   %(image_url)s, %(tags_json)s::jsonb, %(raw_json)s::jsonb)
ON CONFLICT (store, external_id)
DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  unit_size = EXCLUDED.unit_size,
  category_path = EXCLUDED.category_path,
  image_url = EXCLUDED.image_url,
  tags_json = EXCLUDED.tags_json,
  raw_json = EXCLUDED.raw_json
RETURNING id
"""

UPSERT_NUTRITION_SQL = """
INSERT INTO item_nutrition
  (item_id, nutrition, updated_at)
VALUES
  (%(item_id)s, %(nutrition)s, CURRENT_TIMESTAMP)
ON CONFLICT (item_id)
DO UPDATE SET
  nutrition = EXCLUDED.nutrition,
  updated_at = CURRENT_TIMESTAMP
"""

UPSERT_INGREDIENTS_SQL = """
INSERT INTO item_ingredients
  (item_id, ingredients, updated_at)
VALUES
  (%(item_id)s, %(ingredients)s, CURRENT_TIMESTAMP)
ON CONFLICT (item_id)
DO UPDATE SET
  ingredients = EXCLUDED.ingredients,
  updated_at = CURRENT_TIMESTAMP
"""


def get_image_url(raw: dict) -> str | None:
    for field in ("thumbnailImageUrl", "thumbnail", "imageUrl", "image", "mediumImageUrl"):
        val = raw.get(field)
        if val and isinstance(val, str) and val.startswith("http"):
            return val
    return None


def get_unit_size(item: dict, raw: dict) -> str | None:
    # Prefer top-level weight field (set by scraper)
    weight = item.get("weight")
    if weight and isinstance(weight, str) and weight.strip():
        return weight.strip()
    # Fall back to raw fields
    for field in ("packageSize", "netWeight", "unitSize", "size"):
        val = raw.get(field)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return None


def get_tags_json(item: dict, raw: dict) -> str | None:
    tags = []
    # Top-level tags list written by scraper
    for t in item.get("tags") or []:
        if isinstance(t, str) and t.strip():
            tags.append(t.strip())
    # Brand name
    brand = raw.get("brandName") or raw.get("brand")
    if brand and isinstance(brand, str) and brand.strip():
        if brand not in tags:
            tags.append(brand.strip())
    # Additional raw label fields
    for field in ("labels", "badges", "attributes"):
        for entry in raw.get(field) or []:
            label = entry if isinstance(entry, str) else entry.get("name") or entry.get("label") or ""
            if label.strip() and label not in tags:
                tags.append(label.strip())
    return json.dumps(tags) if tags else None


def coerce_price(item: dict) -> float | None:
    p = item.get("price")
    if p is None:
        return None
    if isinstance(p, (int, float)):
        return float(p)
    if isinstance(p, str):
        try:
            return float(p.replace("$", "").replace(",", "").strip())
        except ValueError:
            return None
    return None


def load_parsed_data(nutrition_path: str, ingredients_path: str):
    nutrition_lookup: dict = {}
    ingredients_lookup: dict = {}

    if os.path.exists(nutrition_path):
        with open(nutrition_path, "r", encoding="utf-8") as f:
            nutrition_data = json.load(f)
        for entry in (nutrition_data.get("parsed_items") or []):
            sku = entry.get("sku")
            if sku:
                nutrition_lookup[str(sku)] = entry
        print(f"✅ Loaded {len(nutrition_lookup)} parsed nutrition items from {nutrition_path}")
    else:
        print(f"⚠️  Nutrition parsed file not found: {nutrition_path}")

    if os.path.exists(ingredients_path):
        with open(ingredients_path, "r", encoding="utf-8") as f:
            ingredients_data = json.load(f)
        for entry in (ingredients_data.get("parsed_items") or []):
            sku = entry.get("sku")
            if sku:
                ingredients_lookup[str(sku)] = entry
        print(f"✅ Loaded {len(ingredients_lookup)} parsed ingredients items from {ingredients_path}")
    else:
        print(f"⚠️  Ingredients parsed file not found: {ingredients_path}")

    return nutrition_lookup, ingredients_lookup


def main():
    db_host = os.getenv("PGHOST", "localhost")
    db_port = int(os.getenv("PGPORT", "5432"))
    db_name = os.getenv("PGDATABASE", "mealgen")
    db_user = os.getenv("PGUSER", "meal_user")
    db_pass = os.getenv("PGPASSWORD") or os.environ["PGPASSWORD"]  # required

    json_path = os.getenv("COSTCO_JSON_PATH", "./costco-items.json")
    nutrition_parsed_path = os.getenv(
        "COSTCO_NUTRITION_PARSED_PATH", "./costco-nutrition-parsed.json"
    )
    ingredients_parsed_path = os.getenv(
        "COSTCO_INGREDIENTS_PARSED_PATH", "./costco-ingredients-parsed.json"
    )

    nutrition_lookup, ingredients_lookup = load_parsed_data(
        nutrition_parsed_path, ingredients_parsed_path
    )

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError("Expected a JSON array at the top level")

    conn = psycopg2.connect(
        host=db_host, port=db_port, dbname=db_name, user=db_user, password=db_pass
    )
    conn.autocommit = False

    upserted = 0
    skipped = 0
    nutrition_upserted = 0
    ingredients_upserted = 0

    with conn.cursor() as cur:
        nutrition_batch = []
        ingredients_batch = []

        for item in data:
            if not isinstance(item, dict):
                skipped += 1
                continue

            sku = item.get("sku")
            name = item.get("name") or (item.get("raw") or {}).get("displayName")

            if not sku or not name:
                skipped += 1
                continue

            raw = item.get("raw") or {}

            row = {
                "store": "COSTCO",
                "name": name,
                "external_id": str(sku),
                "price": coerce_price(item),
                "unit_size": get_unit_size(item, raw),
                "category_path": item.get("categories"),
                "image_url": get_image_url(raw),
                "tags_json": get_tags_json(item, raw),
                "raw_json": json.dumps(raw) if raw else None,
            }

            cur.execute(UPSERT_ITEM_SQL, row)
            result = cur.fetchone()
            if not result:
                skipped += 1
                continue
            item_id = result[0]
            sku_str = str(sku)

            # --- Nutrition ---
            nutrition_text = None
            if sku_str in nutrition_lookup:
                parsed_item = nutrition_lookup[sku_str]
                nutrition_text = json.dumps(
                    {
                        "parsed": parsed_item.get("nutrition_parsed"),
                        "raw": parsed_item.get("nutrition_raw"),
                    },
                    ensure_ascii=False,
                )
            else:
                nutrition = item.get("nutrition")
                if nutrition:
                    if not isinstance(nutrition, str):
                        nutrition = json.dumps(nutrition, ensure_ascii=False)
                    if len(nutrition) > 10000:
                        print(f"⚠️  Truncating nutrition for sku={sku_str} ({len(nutrition)} chars)")
                        nutrition = nutrition[:10000]
                    nutrition_text = nutrition

            if nutrition_text:
                nutrition_batch.append({"item_id": item_id, "nutrition": nutrition_text})
                if len(nutrition_batch) >= 500:
                    psycopg2.extras.execute_batch(
                        cur, UPSERT_NUTRITION_SQL, nutrition_batch, page_size=500
                    )
                    nutrition_upserted += len(nutrition_batch)
                    nutrition_batch.clear()

            # --- Ingredients ---
            ingredients_text = None
            if sku_str in ingredients_lookup:
                parsed_item = ingredients_lookup[sku_str]
                ingredients_text = json.dumps(
                    {
                        "parsed": parsed_item.get("ingredients_parsed"),
                        "raw": parsed_item.get("ingredients_raw"),
                    },
                    ensure_ascii=False,
                )
            else:
                ingredients = item.get("ingredients")
                if ingredients:
                    if not isinstance(ingredients, str):
                        ingredients = json.dumps(ingredients, ensure_ascii=False)
                    if len(ingredients) > 5000:
                        print(f"⚠️  Truncating ingredients for sku={sku_str} ({len(ingredients)} chars)")
                        ingredients = ingredients[:5000]
                    ingredients_text = ingredients

            if ingredients_text:
                ingredients_batch.append(
                    {"item_id": item_id, "ingredients": ingredients_text}
                )
                if len(ingredients_batch) >= 500:
                    psycopg2.extras.execute_batch(
                        cur, UPSERT_INGREDIENTS_SQL, ingredients_batch, page_size=500
                    )
                    ingredients_upserted += len(ingredients_batch)
                    ingredients_batch.clear()

            upserted += 1

            if upserted % 1000 == 0:
                # Flush pending batches before committing so nutrition/ingredients
                # are never committed without their parent items.
                if nutrition_batch:
                    psycopg2.extras.execute_batch(
                        cur, UPSERT_NUTRITION_SQL, nutrition_batch, page_size=500
                    )
                    nutrition_upserted += len(nutrition_batch)
                    nutrition_batch.clear()
                if ingredients_batch:
                    psycopg2.extras.execute_batch(
                        cur, UPSERT_INGREDIENTS_SQL, ingredients_batch, page_size=500
                    )
                    ingredients_upserted += len(ingredients_batch)
                    ingredients_batch.clear()
                conn.commit()

        # Flush remaining batches
        if nutrition_batch:
            psycopg2.extras.execute_batch(
                cur, UPSERT_NUTRITION_SQL, nutrition_batch, page_size=500
            )
            nutrition_upserted += len(nutrition_batch)

        if ingredients_batch:
            psycopg2.extras.execute_batch(
                cur, UPSERT_INGREDIENTS_SQL, ingredients_batch, page_size=500
            )
            ingredients_upserted += len(ingredients_batch)

    conn.commit()
    conn.close()

    print(
        f"✅ Import finished. "
        f"items_upserted={upserted}, skipped={skipped}, "
        f"nutrition_upserted={nutrition_upserted}, "
        f"ingredients_upserted={ingredients_upserted}, "
        f"source={json_path}"
    )


if __name__ == "__main__":
    main()
