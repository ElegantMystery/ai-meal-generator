import json
import os
import psycopg2
import psycopg2.extras

TJ_BASE = "https://www.traderjoes.com"

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

def to_abs_url(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("/"):
        return TJ_BASE + path
    return TJ_BASE + "/" + path

def get_unit_size(raw: dict) -> str | None:
    sales_size = raw.get("sales_size")
    uom = raw.get("sales_uom_description")
    if sales_size is None or not uom:
        return None
    return f"{sales_size} {uom}"

def get_image_url(raw: dict) -> str | None:
    pim = raw.get("primary_image_meta") or {}
    image_path = pim.get("url") or raw.get("primary_image")
    return to_abs_url(image_path)

def get_tags_json(raw: dict) -> str | None:
    tags = []
    fun_tags = raw.get("fun_tags") or []
    characteristics = raw.get("item_characteristics") or []
    for t in fun_tags:
        if isinstance(t, str) and t.strip():
            tags.append(t)
    for t in characteristics:
        if isinstance(t, str) and t.strip():
            tags.append(t)
    return json.dumps(tags) if tags else None

def coerce_price(item: dict) -> float | None:
    p = item.get("price")
    if p is None:
        return None
    if isinstance(p, (int, float)):
        return float(p)
    if isinstance(p, str):
        try:
            return float(p)
        except ValueError:
            return None
    return None

def load_parsed_data(nutrition_path: str, ingredients_path: str):
    """
    Load parsed nutrition and ingredients data and create SKU lookup dictionaries.
    
    Returns:
        (nutrition_lookup, ingredients_lookup) - dictionaries keyed by SKU
    """
    nutrition_lookup = {}
    ingredients_lookup = {}
    
    # Load parsed nutrition data
    if os.path.exists(nutrition_path):
        with open(nutrition_path, "r", encoding="utf-8") as f:
            nutrition_data = json.load(f)
        
        if isinstance(nutrition_data, dict) and "parsed_items" in nutrition_data:
            for item in nutrition_data["parsed_items"]:
                sku = item.get("sku")
                if sku:
                    nutrition_lookup[str(sku)] = item
        print(f"✅ Loaded {len(nutrition_lookup)} parsed nutrition items from {nutrition_path}")
    else:
        print(f"⚠️  Nutrition parsed file not found: {nutrition_path}")
    
    # Load parsed ingredients data
    if os.path.exists(ingredients_path):
        with open(ingredients_path, "r", encoding="utf-8") as f:
            ingredients_data = json.load(f)
        
        if isinstance(ingredients_data, dict) and "parsed_items" in ingredients_data:
            for item in ingredients_data["parsed_items"]:
                sku = item.get("sku")
                if sku:
                    ingredients_lookup[str(sku)] = item
        print(f"✅ Loaded {len(ingredients_lookup)} parsed ingredients items from {ingredients_path}")
    else:
        print(f"⚠️  Ingredients parsed file not found: {ingredients_path}")
    
    return nutrition_lookup, ingredients_lookup

def main():
    # Update these or pass via env vars
    db_host = os.getenv("PGHOST", "localhost")
    db_port = int(os.getenv("PGPORT", "5432"))
    db_name = os.getenv("PGDATABASE", "mealgen")
    db_user = os.getenv("PGUSER", "meal_user")
    db_pass = os.getenv("PGPASSWORD", "236810")

    json_path = os.getenv("TJ_JSON_PATH", "./tj-items.json")
    nutrition_parsed_path = os.getenv("TJ_NUTRITION_PARSED_PATH", "./tj-nutrition-parsed.json")
    ingredients_parsed_path = os.getenv("TJ_INGREDIENTS_PARSED_PATH", "./tj-ingredients-parsed.json")

    # Load parsed data
    nutrition_lookup, ingredients_lookup = load_parsed_data(nutrition_parsed_path, ingredients_parsed_path)

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

            store = item.get("store") or "TRADER_JOES"
            sku = item.get("sku")
            name = item.get("name") or (item.get("raw") or {}).get("item_title")

            if not sku or not name:
                skipped += 1
                continue

            raw = item.get("raw") or {}

            # Upsert item and get the item_id
            row = {
                "store": store,
                "name": name,
                "external_id": str(sku),
                "price": coerce_price(item),
                "unit_size": get_unit_size(raw),
                "category_path": item.get("categories"),
                "image_url": get_image_url(raw),
                "tags_json": get_tags_json(raw),
                "raw_json": json.dumps(raw) if raw else None,
            }
            
            # Insert/update item and get the item_id
            cur.execute(UPSERT_ITEM_SQL, row)
            result = cur.fetchone()
            if not result:
                skipped += 1
                continue
            item_id = result[0]
            
            # Try to get parsed nutrition data first, fall back to raw if not available
            sku_str = str(sku)
            nutrition_text = None
            
            if sku_str in nutrition_lookup:
                # Use parsed data - store as JSON string
                parsed_item = nutrition_lookup[sku_str]
                nutrition_data = {
                    "parsed": parsed_item.get("nutrition_parsed"),
                    "raw": parsed_item.get("nutrition_raw")
                }
                nutrition_text = json.dumps(nutrition_data, ensure_ascii=False)
            else:
                # Fall back to raw nutrition text from original item
                nutrition = item.get("nutrition")
                if nutrition:
                    # Truncate if too long
                    if len(nutrition) > 10000:
                        nutrition = nutrition[:10000]
                    nutrition_text = nutrition
            
            # Add nutrition to batch if available
            if nutrition_text:
                nutrition_row = {
                    "item_id": item_id,
                    "nutrition": nutrition_text,
                }
                nutrition_batch.append(nutrition_row)
                
                # Flush nutrition batch in chunks
                if len(nutrition_batch) >= 500:
                    psycopg2.extras.execute_batch(cur, UPSERT_NUTRITION_SQL, nutrition_batch, page_size=500)
                    nutrition_upserted += len(nutrition_batch)
                    nutrition_batch.clear()
            
            # Try to get parsed ingredients data first, fall back to raw if not available
            ingredients_text = None
            
            if sku_str in ingredients_lookup:
                # Use parsed data - store as JSON string
                parsed_item = ingredients_lookup[sku_str]
                ingredients_data = {
                    "parsed": parsed_item.get("ingredients_parsed"),
                    "raw": parsed_item.get("ingredients_raw")
                }
                ingredients_text = json.dumps(ingredients_data, ensure_ascii=False)
            else:
                # Fall back to raw ingredients text from original item
                ingredients = item.get("ingredients")
                if ingredients:
                    # Truncate if too long
                    if len(ingredients) > 5000:
                        ingredients = ingredients[:5000]
                    ingredients_text = ingredients
            
            # Add ingredients to batch if available
            if ingredients_text:
                ingredients_row = {
                    "item_id": item_id,
                    "ingredients": ingredients_text,
                }
                ingredients_batch.append(ingredients_row)
                
                # Flush ingredients batch in chunks
                if len(ingredients_batch) >= 500:
                    psycopg2.extras.execute_batch(cur, UPSERT_INGREDIENTS_SQL, ingredients_batch, page_size=500)
                    ingredients_upserted += len(ingredients_batch)
                    ingredients_batch.clear()
            
            upserted += 1
            
            # Commit periodically to avoid long transactions
            if upserted % 1000 == 0:
                conn.commit()

        # Flush remaining batches
        if nutrition_batch:
            psycopg2.extras.execute_batch(cur, UPSERT_NUTRITION_SQL, nutrition_batch, page_size=500)
            nutrition_upserted += len(nutrition_batch)
        
        if ingredients_batch:
            psycopg2.extras.execute_batch(cur, UPSERT_INGREDIENTS_SQL, ingredients_batch, page_size=500)
            ingredients_upserted += len(ingredients_batch)

    conn.commit()
    conn.close()

    print(f"✅ Import finished. items_upserted={upserted}, skipped={skipped}, nutrition_upserted={nutrition_upserted}, ingredients_upserted={ingredients_upserted}, source={json_path}")

if __name__ == "__main__":
    main()
