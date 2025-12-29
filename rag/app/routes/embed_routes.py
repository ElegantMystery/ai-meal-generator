import logging
from fastapi import APIRouter, Header, HTTPException
from typing import Optional

from ..models import BackfillRequest, BackfillResponse
from ..config import RAG_SHARED_SECRET
from ..retrieval import (
    fetch_items_missing_embeddings, 
    upsert_item_embeddings,
    fetch_nutrition_missing_embeddings,
    fetch_ingredients_missing_embeddings,
    upsert_nutrition_embeddings,
    upsert_ingredients_embeddings
)
from ..embedding import item_doc, nutrition_doc, ingredients_doc, embed_texts

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/embed", tags=["embed"])

def auth(secret: Optional[str]):
    if RAG_SHARED_SECRET and secret != RAG_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

@router.post("/backfill/items", response_model=BackfillResponse)
def backfill(req: BackfillRequest, x_rag_secret: Optional[str] = Header(default=None)):
    """Backfill embeddings for items."""
    auth(x_rag_secret)

    rows = fetch_items_missing_embeddings(req.store, req.limit)
    if not rows:
        return BackfillResponse(updated=0, skipped=0)

    texts = [item_doc(r) for r in rows]
    vectors = embed_texts(texts)
    updated = upsert_item_embeddings(rows, vectors)
    return BackfillResponse(updated=updated, skipped=0)

@router.post("/backfill/nutrition", response_model=BackfillResponse)
def backfill_nutrition(req: BackfillRequest, x_rag_secret: Optional[str] = Header(default=None)):
    """Backfill embeddings for item nutrition data."""
    auth(x_rag_secret)

    rows = fetch_nutrition_missing_embeddings(req.store, req.limit)
    if not rows:
        return BackfillResponse(updated=0, skipped=0)

    texts = [nutrition_doc(r) for r in rows]
    vectors = embed_texts(texts)
    updated = upsert_nutrition_embeddings(rows, vectors)
    return BackfillResponse(updated=updated, skipped=0)

@router.post("/backfill/ingredients", response_model=BackfillResponse)
def backfill_ingredients(req: BackfillRequest, x_rag_secret: Optional[str] = Header(default=None)):
    """Backfill embeddings for item ingredients data."""
    auth(x_rag_secret)

    rows = fetch_ingredients_missing_embeddings(req.store, req.limit)
    if not rows:
        return BackfillResponse(updated=0, skipped=0)

    texts = [ingredients_doc(r) for r in rows]
    vectors = embed_texts(texts)
    updated = upsert_ingredients_embeddings(rows, vectors)
    return BackfillResponse(updated=updated, skipped=0)
