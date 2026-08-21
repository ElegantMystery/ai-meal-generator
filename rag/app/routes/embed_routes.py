import logging

from fastapi import APIRouter, Depends

from ..embedding import embed_texts, ingredients_doc, item_doc, nutrition_doc
from ..models import BackfillRequest, BackfillResponse
from ..retrieval import (
    fetch_ingredients_missing_embeddings,
    fetch_items_missing_embeddings,
    fetch_nutrition_missing_embeddings,
    upsert_ingredients_embeddings,
    upsert_item_embeddings,
    upsert_nutrition_embeddings,
)
from ..security import require_rag_secret

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/embed",
    tags=["embed"],
    dependencies=[Depends(require_rag_secret)],
)


@router.post("/backfill/items", response_model=BackfillResponse)
def backfill(req: BackfillRequest):
    """Backfill embeddings for items."""
    rows = fetch_items_missing_embeddings(req.store, req.limit)
    if not rows:
        return BackfillResponse(updated=0, skipped=0)

    texts = [item_doc(r) for r in rows]
    vectors = embed_texts(texts)
    updated = upsert_item_embeddings(rows, vectors)
    return BackfillResponse(updated=updated, skipped=0)


@router.post("/backfill/nutrition", response_model=BackfillResponse)
def backfill_nutrition(req: BackfillRequest):
    """Backfill embeddings for item nutrition data."""
    rows = fetch_nutrition_missing_embeddings(req.store, req.limit)
    if not rows:
        return BackfillResponse(updated=0, skipped=0)

    texts = [nutrition_doc(r) for r in rows]
    vectors = embed_texts(texts)
    updated = upsert_nutrition_embeddings(rows, vectors)
    return BackfillResponse(updated=updated, skipped=0)


@router.post("/backfill/ingredients", response_model=BackfillResponse)
def backfill_ingredients(req: BackfillRequest):
    """Backfill embeddings for item ingredients data."""
    rows = fetch_ingredients_missing_embeddings(req.store, req.limit)
    if not rows:
        return BackfillResponse(updated=0, skipped=0)

    texts = [ingredients_doc(r) for r in rows]
    vectors = embed_texts(texts)
    updated = upsert_ingredients_embeddings(rows, vectors)
    return BackfillResponse(updated=updated, skipped=0)
