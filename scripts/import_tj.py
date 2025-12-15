import json
import os
import psycopg2
import psycopg2.extras

TJ_BASE = "https://www.traderjoes.com"

UPSERT_SQL = """
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

def main():
    # Update these or pass via env vars
    db_host = os.getenv("PGHOST", "localhost")
    db_port = int(os.getenv("PGPORT", "5432"))
    db_name = os.getenv("PGDATABASE", "mealgen")
    db_user = os.getenv("PGUSER", "meal_user")
    db_pass = os.getenv("PGPASSWORD", "236810")

    json_path = os.getenv("TJ_JSON_PATH", "./tj-items.json")

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

    with conn.cursor() as cur:
        batch = []
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
            batch.append(row)

            # Flush in chunks
            if len(batch) >= 500:
                psycopg2.extras.execute_batch(cur, UPSERT_SQL, batch, page_size=500)
                upserted += len(batch)
                batch.clear()

        if batch:
            psycopg2.extras.execute_batch(cur, UPSERT_SQL, batch, page_size=500)
            upserted += len(batch)

    conn.commit()
    conn.close()

    print(f"✅ Import finished. upserted={upserted}, skipped={skipped}, source={json_path}")

if __name__ == "__main__":
    main()
