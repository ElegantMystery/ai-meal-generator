import os
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import psycopg
from psycopg.rows import dict_row
from pgvector.psycopg import register_vector
from dotenv import load_dotenv
from tqdm import tqdm

from openai import OpenAI

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
# For local runs, default to localhost instead of container hostname
if DATABASE_URL and "postgres-mealgen" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgres-mealgen", "localhost")
elif not DATABASE_URL:
    # Default local connection if not set
    DATABASE_URL = "postgresql://meal_user:236810@localhost:5432/mealgen"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "128"))

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is required")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is required")

client = OpenAI(api_key=OPENAI_API_KEY)


def item_to_text(item: Dict[str, Any]) -> str:
    """
    Build a stable, compact 'document' string for embeddings.
    Keep it consistent across runs so vector meaning stays comparable.
    """
    parts = [
        f"name: {item.get('name','')}",
        f"store: {item.get('store','')}",
        f"category: {item.get('category_path','')}",
        f"unit_size: {item.get('unit_size','')}",
        f"price: {item.get('price','')}",
    ]

    # Optional fields if present in your schema
    if item.get("tags_json") is not None:
        parts.append(f"tags: {json.dumps(item.get('tags_json'), ensure_ascii=False)}")
    if item.get("raw_json") is not None:
        # raw_json can be huge; include only if you really want it
        pass

    return "\n".join(parts).strip()


def embed_texts(texts: List[str]) -> List[List[float]]:
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    # OpenAI returns embeddings in the same order as input
    return [d.embedding for d in resp.data]


def fetch_items_missing_embeddings(conn, limit: int, store: str | None) -> List[Dict[str, Any]]:
    """
    Pull items that don't have an embedding row yet.
    """
    where_store = ""
    params: List[Any] = []
    if store:
        where_store = "AND i.store ILIKE %s"
        params.append(store)

    params.append(limit)

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
              i.id,
              i.store,
              i.name,
              i.category_path,
              i.unit_size,
              i.price,
              i.tags_json
            FROM items i
            LEFT JOIN item_embeddings e ON e.item_id = i.id
            WHERE e.item_id IS NULL
              {where_store}
            ORDER BY i.id
            LIMIT %s
            """,
            params,
        )
        return cur.fetchall()


def upsert_embeddings(conn, rows: List[Tuple[int, List[float]]]) -> None:
    """
    rows: [(item_id, embedding_vector), ...]
    """
    now = datetime.now(timezone.utc)

    with conn.cursor() as cur:
        for item_id, emb in rows:
            cur.execute(
                """
                INSERT INTO item_embeddings (item_id, embedding, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (item_id)
                DO UPDATE SET embedding = EXCLUDED.embedding,
                              updated_at = EXCLUDED.updated_at
                """,
                (item_id, emb, now),
            )


def main():
    # Usage: python3 backfill_item_embeddings.py --store TRADER_JOES --limit 5000
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--store", default=None, help="Optional store filter: TRADER_JOES or COSTCO")
    parser.add_argument("--limit", type=int, default=5000, help="Max items to process in this run")
    parser.add_argument("--chunk", type=int, default=BATCH_SIZE, help="Embedding batch size")
    args = parser.parse_args()

    processed = 0

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        register_vector(conn)

        pbar = tqdm(total=args.limit, desc="Embedding items", unit="item")
        while processed < args.limit:
            batch_items = fetch_items_missing_embeddings(conn, limit=args.chunk, store=args.store)
            if not batch_items:
                break

            texts = [item_to_text(it) for it in batch_items]
            vectors = embed_texts(texts)

            upsert_rows = [(it["id"], vec) for it, vec in zip(batch_items, vectors)]
            upsert_embeddings(conn, upsert_rows)

            conn.commit()

            processed += len(batch_items)
            pbar.update(len(batch_items))

        pbar.close()

    print(f"Done. Embedded {processed} items (store={args.store}).")


if __name__ == "__main__":
    main()
