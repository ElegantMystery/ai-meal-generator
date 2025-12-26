import logging
from fastapi import APIRouter, Header, HTTPException
from typing import Optional

from ..models import BackfillRequest, BackfillResponse
from ..config import RAG_SHARED_SECRET
from ..retrieval import fetch_items_missing_embeddings, upsert_item_embeddings
from ..embedding import item_doc, embed_texts

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/embed", tags=["embed"])

def auth(secret: Optional[str]):
    if RAG_SHARED_SECRET and secret != RAG_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

@router.post("/backfill", response_model=BackfillResponse)
def backfill(req: BackfillRequest, x_rag_secret: Optional[str] = Header(default=None)):
    auth(x_rag_secret)

    rows = fetch_items_missing_embeddings(req.store, req.limit)
    if not rows:
        return BackfillResponse(updated=0, skipped=0)

    texts = [item_doc(r) for r in rows]
    vectors = embed_texts(texts)
    updated = upsert_item_embeddings(rows, vectors)
    return BackfillResponse(updated=updated, skipped=0)
