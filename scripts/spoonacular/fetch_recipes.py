"""
Fetch popular recipes from Spoonacular and upsert into the `recipes` table.

Usage:
    source .venv/bin/activate
    export DATABASE_URL=postgresql://meal_user:<your-db-password>@localhost:5432/mealgen
    export SPOONACULAR_API_KEY=<your-key>
    export OPENAI_API_KEY=<your-key>   # only needed with --embed

    python scripts/spoonacular/fetch_recipes.py --total 300
    python scripts/spoonacular/fetch_recipes.py --total 300 --embed
"""

import argparse
import json
import os
import time
from typing import Any, Dict, List, Optional

import psycopg
import requests
from dotenv import load_dotenv
from psycopg.rows import dict_row

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
SPOONACULAR_API_KEY = os.getenv("SPOONACULAR_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")

SPOONACULAR_BASE = "https://api.spoonacular.com"
PAGE_SIZE = 100          # max Spoonacular allows per request
RATE_LIMIT_DELAY = 0.5  # seconds between API calls (free tier: 150 req/day)


# ---------------------------------------------------------------------------
# Spoonacular API helpers
# ---------------------------------------------------------------------------

def _api_get(path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Make a GET request to Spoonacular, raise on error."""
    if not SPOONACULAR_API_KEY:
        raise RuntimeError("SPOONACULAR_API_KEY is not set")
    params["apiKey"] = SPOONACULAR_API_KEY
    url = f"{SPOONACULAR_BASE}{path}"
    resp = requests.get(url, params=params, timeout=30)
    if resp.status_code == 402:
        raise RuntimeError("Spoonacular quota exceeded (402). Check your plan.")
    resp.raise_for_status()
    return resp.json()


def fetch_popular_recipes(offset: int, number: int) -> List[Dict[str, Any]]:
    """
    Fetch recipes sorted by popularity.
    addRecipeInformation=true gives us all fields in one call.
    """
    data = _api_get("/recipes/complexSearch", {
        "sort": "popularity",
        "number": number,
        "offset": offset,
        "addRecipeInformation": "true",
        "fillIngredients": "true",
    })
    return data.get("results", [])


# ---------------------------------------------------------------------------
# Transform Spoonacular response → DB row
# ---------------------------------------------------------------------------

def _extract_instructions(recipe: Dict[str, Any]) -> Optional[str]:
    """
    Prefer analyzedInstructions (step list) → fall back to raw instructions string.
    Returns a plain-text summary joined by spaces.
    """
    analyzed = recipe.get("analyzedInstructions") or []
    steps = []
    for section in analyzed:
        for step in section.get("steps", []):
            text = step.get("step", "").strip()
            if text:
                steps.append(text)
    if steps:
        return " ".join(steps)

    raw = recipe.get("instructions") or ""
    # Strip HTML tags if present
    import re
    raw = re.sub(r"<[^>]+>", " ", raw).strip()
    return raw or None


def _extract_ingredients(recipe: Dict[str, Any]) -> Optional[str]:
    """
    Build a compact JSON list [{name, amount, unit, aisle}] from extendedIngredients.
    """
    ext = recipe.get("extendedIngredients") or []
    if not ext:
        return None
    compact = [
        {
            "name": ing.get("name", ""),
            "amount": ing.get("amount"),
            "unit": ing.get("unit", ""),
            "aisle": ing.get("aisle", ""),
        }
        for ing in ext
    ]
    return json.dumps(compact, ensure_ascii=False)


def recipe_to_row(recipe: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "source_id": str(recipe["id"]),
        "source": "spoonacular",
        "title": recipe.get("title", "")[:255],
        "image_url": (recipe.get("image") or "")[:512] or None,
        "ready_minutes": recipe.get("readyInMinutes"),
        "servings": recipe.get("servings"),
        "dish_types": recipe.get("dishTypes") or [],
        "diets": recipe.get("diets") or [],
        "cuisines": recipe.get("cuisines") or [],
        "ingredients_json": _extract_ingredients(recipe),
        "instructions": _extract_instructions(recipe),
        "raw_json": json.dumps(recipe, ensure_ascii=False),
    }


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------

def upsert_recipes(conn, rows: List[Dict[str, Any]]) -> int:
    inserted = 0
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                INSERT INTO recipes (
                    source_id, source, title, image_url,
                    ready_minutes, servings,
                    dish_types, diets, cuisines,
                    ingredients_json, instructions, raw_json,
                    updated_at
                ) VALUES (
                    %(source_id)s, %(source)s, %(title)s, %(image_url)s,
                    %(ready_minutes)s, %(servings)s,
                    %(dish_types)s, %(diets)s, %(cuisines)s,
                    %(ingredients_json)s, %(instructions)s, %(raw_json)s::jsonb,
                    CURRENT_TIMESTAMP
                )
                ON CONFLICT (source, source_id) DO UPDATE SET
                    title            = EXCLUDED.title,
                    image_url        = EXCLUDED.image_url,
                    ready_minutes    = EXCLUDED.ready_minutes,
                    servings         = EXCLUDED.servings,
                    dish_types       = EXCLUDED.dish_types,
                    diets            = EXCLUDED.diets,
                    cuisines         = EXCLUDED.cuisines,
                    ingredients_json = EXCLUDED.ingredients_json,
                    instructions     = EXCLUDED.instructions,
                    raw_json         = EXCLUDED.raw_json,
                    updated_at       = CURRENT_TIMESTAMP
                """,
                row,
            )
            inserted += 1
    conn.commit()
    return inserted


# ---------------------------------------------------------------------------
# Optional: embed recipe title + ingredients → recipe_embeddings
# ---------------------------------------------------------------------------

def _recipe_to_embed_text(row: Dict[str, Any]) -> str:
    parts = [f"recipe: {row['title']}"]
    if row.get("ingredients_json"):
        try:
            ings = json.loads(row["ingredients_json"])
            names = [i["name"] for i in ings if i.get("name")]
            parts.append(f"ingredients: {', '.join(names)}")
        except Exception:
            pass
    if row.get("dish_types"):
        parts.append(f"dish types: {', '.join(row['dish_types'])}")
    if row.get("cuisines"):
        parts.append(f"cuisines: {', '.join(row['cuisines'])}")
    return "\n".join(parts)


def backfill_recipe_embeddings(conn) -> int:
    """Embed all recipes that are missing an embedding."""
    from openai import OpenAI
    from pgvector.psycopg import register_vector

    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is required for --embed")

    register_vector(conn)
    oai = OpenAI(api_key=OPENAI_API_KEY)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT r.id, r.title, r.ingredients_json, r.dish_types, r.cuisines
            FROM recipes r
            LEFT JOIN recipe_embeddings re ON r.id = re.recipe_id
            WHERE re.recipe_id IS NULL
            ORDER BY r.id
        """)
        rows = cur.fetchall()

    if not rows:
        print("No recipes missing embeddings.")
        return 0

    texts = [_recipe_to_embed_text(r) for r in rows]
    BATCH = 100
    total_embedded = 0

    for i in range(0, len(texts), BATCH):
        batch_texts = texts[i:i + BATCH]
        batch_rows = rows[i:i + BATCH]

        resp = oai.embeddings.create(model=EMBED_MODEL, input=batch_texts)
        vectors = [d.embedding for d in resp.data]

        with conn.cursor() as cur:
            for row, vec in zip(batch_rows, vectors):
                cur.execute(
                    """
                    INSERT INTO recipe_embeddings (recipe_id, embedding, updated_at)
                    VALUES (%s, %s, CURRENT_TIMESTAMP)
                    ON CONFLICT (recipe_id) DO UPDATE
                    SET embedding = EXCLUDED.embedding, updated_at = CURRENT_TIMESTAMP
                    """,
                    (row["id"], vec),
                )
        conn.commit()
        total_embedded += len(batch_rows)
        print(f"  Embedded {total_embedded}/{len(rows)} recipes...")
        time.sleep(0.1)

    return total_embedded


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Fetch Spoonacular recipes into DB")
    parser.add_argument("--total", type=int, default=300,
                        help="Total number of recipes to fetch (default: 300)")
    parser.add_argument("--embed", action="store_true",
                        help="Also backfill recipe_embeddings after import")
    args = parser.parse_args()

    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")
    if not SPOONACULAR_API_KEY:
        raise RuntimeError("SPOONACULAR_API_KEY is not set")

    db_url = DATABASE_URL
    if "postgres-mealgen" in db_url:
        db_url = db_url.replace("postgres-mealgen", "localhost")

    total_upserted = 0

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        offset = 0
        while total_upserted < args.total:
            number = min(PAGE_SIZE, args.total - total_upserted)
            print(f"Fetching recipes offset={offset}, number={number}...")

            try:
                recipes = fetch_popular_recipes(offset=offset, number=number)
            except requests.HTTPError as e:
                print(f"HTTP error fetching recipes: {e}")
                break

            if not recipes:
                print("No more recipes returned by Spoonacular.")
                break

            rows = [recipe_to_row(r) for r in recipes]
            n = upsert_recipes(conn, rows)
            total_upserted += n
            offset += len(recipes)

            print(f"  Upserted {n} recipes (total so far: {total_upserted})")

            if len(recipes) < number:
                break  # Spoonacular returned fewer than requested

            time.sleep(RATE_LIMIT_DELAY)

        print(f"\nDone. Total recipes upserted: {total_upserted}")

        if args.embed:
            print("\nBackfilling recipe embeddings...")
            embedded = backfill_recipe_embeddings(conn)
            print(f"Embedded {embedded} recipes.")


if __name__ == "__main__":
    main()
