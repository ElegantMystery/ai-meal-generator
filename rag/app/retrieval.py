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

def retrieve_candidates(store: str, query_vec: List[float], k: int = RETRIEVAL_K):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
              SELECT i.id, i.name, i.price, i.unit_size, i.category_path, i.image_url
              FROM items i
              INNER JOIN item_embeddings ie ON i.id = ie.item_id
              WHERE i.store ILIKE %s
              ORDER BY ie.embedding <=> %s::vector
              LIMIT %s
            """, (store, query_vec, k))
            return cur.fetchall()

def verify_ids(store: str, ids: List[int]) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
              SELECT id FROM items
              WHERE store ILIKE %s AND id = ANY(%s)
            """, (store, ids))
            rows = cur.fetchall()
    return len(rows) == len(set(ids))
