# app/verify.py
from typing import List
from fastapi import HTTPException

from .db import get_conn


def verify_item_ids_belong_to_store(store: str, item_ids: List[int]) -> None:
    """
    Verifies that every item_id exists in items table AND belongs to the given store.
    Throws HTTPException(500) if any are missing (means LLM invented IDs).
    """
    if not item_ids:
        raise HTTPException(status_code=500, detail="AI returned no item ids")

    # Deduplicate to reduce query cost
    unique_ids = sorted(set(item_ids))

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM items
                WHERE store ILIKE %s AND id = ANY(%s)
                """,
                (store, unique_ids),
            )
            rows = cur.fetchall()

    found = {r["id"] for r in rows}
    missing = [i for i in unique_ids if i not in found]
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"LLM returned invalid item ids for store={store}: {missing[:25]}",
        )
