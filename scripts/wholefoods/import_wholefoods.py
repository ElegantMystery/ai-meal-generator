#!/usr/bin/env python3
"""
Import Whole Foods items into the mealgen database.

Reads wholefoods-items.json (from scrape_wholefoods.js) plus optional parsed
nutrition/ingredients files, then upserts into items / item_nutrition /
item_ingredients tables — same schema used by the TJ pipeline.

Environment variables:
  PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD  — DB connection
  WF_JSON_PATH           — path to wholefoods-items.json          (default: ./wholefoods-items.json)
  WF_NUTRITION_PARSED    — path to wholefoods-nutrition-parsed.json (default: ./wholefoods-nutrition-parsed.json)
  WF_INGREDIENTS_PARSED  — path to wholefoods-ingredients-parsed.json (default: ./wholefoods-ingredients-parsed.json)
"""

from __future__ import annotations

import json
import os
import psycopg2
import psycopg2.extras

UPSERT_ITEM_SQL = """
INSERT INTO items
  (store, name, external_id, price, unit_size, category_path, image_url, tags_json, raw_json)
VALUES
  (%(store)s, %(name)s, %(external_id)s, %(price)s, %(unit_size)s, %(category_path)s,
   %(image_url)s, %(tags_json)s::jsonb, %(raw_json)s::jsonb)
ON CONFLICT (store, external_id)
DO UPDATE SET
  name          = EXCLUDED.name,
  price         = EXCLUDED.price,
  unit_size     = EXCLUDED.unit_size,
  category_path = EXCLUDED.category_path,
  image_url     = EXCLUDED.image_url,
  tags_json     = EXCLUDED.tags_json,
  raw_json      = EXCLUDED.raw_json
RETURNING id
"""

UPSERT_NUTRITION_SQL = """
INSERT INTO item_nutrition (item_id, nutrition, updated_at)
VALUES (%(item_id)s, %(nutrition)s, CURRENT_TIMESTAMP)
ON CONFLICT (item_id)
DO UPDATE SET nutrition = EXCLUDED.nutrition, updated_at = CURRENT_TIMESTAMP
"""

UPSERT_INGREDIENTS_SQL = """
INSERT INTO item_ingredients (item_id, ingredients, updated_at)
VALUES (%(item_id)s, %(ingredients)s, CURRENT_TIMESTAMP)
ON CONFLICT (item_id)
DO UPDATE SET ingredients = EXCLUDED.ingredients, updated_at = CURRENT_TIMESTAMP
"""


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


def load_parsed_lookup(path: str, label: str) -> dict:
    """Load a parse_*.py output file and return a {sku: item} dict."""
    if not os.path.exists(path):
        print(f"⚠️  {label} file not found: {path}")
        return {}
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    lookup = {}
    for item in (data.get("parsed_items") or []):
        sku = item.get("sku")
        if sku:
            lookup[str(sku)] = item
    print(f"✅ Loaded {len(lookup)} {label} items from {path}")
    return lookup


def main() -> None:
    db_host = os.getenv("PGHOST", "localhost")
    db_port = int(os.getenv("PGPORT", "5432"))
    db_name = os.getenv("PGDATABASE", "mealgen")
    db_user = os.getenv("PGUSER", "meal_user")
    db_pass = os.environ["PGPASSWORD"]  # required — no default

    json_path          = os.getenv("WF_JSON_PATH",          "./wholefoods-items.json")
    nutrition_path     = os.getenv("WF_NUTRITION_PARSED",    "./wholefoods-nutrition-parsed.json")
    ingredients_path   = os.getenv("WF_INGREDIENTS_PARSED",  "./wholefoods-ingredients-parsed.json")

    nutrition_lookup    = load_parsed_lookup(nutrition_path,   "nutrition")
    ingredients_lookup  = load_parsed_lookup(ingredients_path, "ingredients")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError("Expected a JSON array at the top level")

    conn = psycopg2.connect(
        host=db_host, port=db_port, dbname=db_name, user=db_user, password=db_pass
    )
    conn.autocommit = False

    upserted = skipped = nutrition_upserted = ingredients_upserted = 0

    with conn.cursor() as cur:
        nutrition_batch: list = []
        ingredients_batch: list = []

        for item in data:
            if not isinstance(item, dict):
                skipped += 1
                continue

            sku  = item.get("sku")
            name = item.get("name", "").strip()
            if not sku or not name:
                skipped += 1
                continue

            raw = item.get("raw") or {}

            tags = item.get("tags") or []
            tags_json = json.dumps(tags) if tags else None

            row = {
                "store":         "WHOLE_FOODS",
                "name":          name,
                "external_id":   str(sku),
                "price":         coerce_price(item),
                "unit_size":     item.get("weight"),       # WF weight field (usually null)
                "category_path": item.get("categories"),
                "image_url":     item.get("image_url"),
                "tags_json":     tags_json,
                "raw_json":      json.dumps(raw) if raw else None,
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
                pi = nutrition_lookup[sku_str]
                nutrition_text = json.dumps(
                    {"parsed": pi.get("nutrition_parsed"), "raw": pi.get("nutrition_raw")},
                    ensure_ascii=False,
                )
            elif item.get("nutrition"):
                raw_nut = item["nutrition"]
                if not isinstance(raw_nut, str):
                    raw_nut = json.dumps(raw_nut, ensure_ascii=False)
                nutrition_text = raw_nut[:10_000]

            if nutrition_text:
                nutrition_batch.append({"item_id": item_id, "nutrition": nutrition_text})
                if len(nutrition_batch) >= 500:
                    psycopg2.extras.execute_batch(cur, UPSERT_NUTRITION_SQL, nutrition_batch, page_size=500)
                    nutrition_upserted += len(nutrition_batch)
                    nutrition_batch.clear()

            # --- Ingredients ---
            ingredients_text = None
            if sku_str in ingredients_lookup:
                pi = ingredients_lookup[sku_str]
                ingredients_text = json.dumps(
                    {"parsed": pi.get("ingredients_parsed"), "raw": pi.get("ingredients_raw")},
                    ensure_ascii=False,
                )
            elif item.get("ingredients"):
                raw_ing = item["ingredients"]
                if not isinstance(raw_ing, str):
                    raw_ing = json.dumps(raw_ing, ensure_ascii=False)
                ingredients_text = raw_ing[:5_000]

            if ingredients_text:
                ingredients_batch.append({"item_id": item_id, "ingredients": ingredients_text})
                if len(ingredients_batch) >= 500:
                    psycopg2.extras.execute_batch(cur, UPSERT_INGREDIENTS_SQL, ingredients_batch, page_size=500)
                    ingredients_upserted += len(ingredients_batch)
                    ingredients_batch.clear()

            upserted += 1
            if upserted % 1000 == 0:
                conn.commit()
                print(f"  ... {upserted} items committed")

        # Flush remaining batches
        if nutrition_batch:
            psycopg2.extras.execute_batch(cur, UPSERT_NUTRITION_SQL, nutrition_batch, page_size=500)
            nutrition_upserted += len(nutrition_batch)
        if ingredients_batch:
            psycopg2.extras.execute_batch(cur, UPSERT_INGREDIENTS_SQL, ingredients_batch, page_size=500)
            ingredients_upserted += len(ingredients_batch)

    conn.commit()
    conn.close()

    print(
        f"✅ Import finished. "
        f"items={upserted}, skipped={skipped}, "
        f"nutrition={nutrition_upserted}, ingredients={ingredients_upserted}, "
        f"source={json_path}"
    )


if __name__ == "__main__":
    main()
