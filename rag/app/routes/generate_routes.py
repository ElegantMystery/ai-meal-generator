import json
import logging
import uuid
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from ..models import GenerateRequest, GenerateResponse
from ..config import RAG_SHARED_SECRET
from ..embedding import embed_one
from ..retrieval import retrieve_candidates
from ..llm import call_mealplan_llm
from ..validators import parse_and_validate_plan_json, extract_item_ids
from ..verify import verify_item_ids_belong_to_store
from ..config import CHAT_MODEL, EMBED_MODEL, RETRIEVAL_K

logger = logging.getLogger(__name__)
router = APIRouter(tags=["generate"])

def auth(secret: Optional[str]):
    if RAG_SHARED_SECRET and secret != RAG_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

@router.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest, x_rag_secret: Optional[str] = Header(default=None)):
    auth(x_rag_secret)

    if req.days < 1 or req.days > 14:
        raise HTTPException(status_code=400, detail="days must be between 1 and 14")

    query_text = f"""
    Create a {req.days}-day meal plan using {req.store} grocery items.
    Dietary restrictions: {req.preferences.dietaryRestrictions or "none"}.
    Disliked ingredients: {req.preferences.dislikedIngredients or "none"}.
    Target calories per day: {req.preferences.targetCaloriesPerDay or "not specified"}.
    Prefer variety and practical meals.
    """.strip()

    qvec = embed_one(query_text)
    candidates = retrieve_candidates(req.store, qvec)

    if not candidates:
        raise HTTPException(status_code=400, detail="No embedded items found. Run /embed/backfill first.")

    start = date.today()
    end = start + timedelta(days=req.days - 1)

    system = "You are a meal-planning assistant. Only use the provided items."
    payload = {
        "store": req.store,
        "days": req.days,
        "startDate": str(start),
        "preferences": req.preferences.model_dump(),
        "items": candidates
    }

    # Log OpenAI API input
    logger.info("OpenAI API input - System: %s", system)
    logger.info("OpenAI API input - Payload: %s", json.dumps(payload, indent=2, ensure_ascii=False))
    logger.info("OpenAI API input - Number of candidates: %d", len(candidates))

    content = call_mealplan_llm(system, payload, temperature=0.4)
    if not content:
        raise HTTPException(status_code=500, detail="LLM returned empty response")

    rag_id = str(uuid.uuid4())

    doc = parse_and_validate_plan_json(content)

    # Verify IDs exist + store matches
    ids = extract_item_ids(doc)
    verify_item_ids_belong_to_store(req.store, ids)

    # Add traceable meta
    doc_dict = doc.model_dump()
    doc_dict["_meta"] = {
        "generatedBy": "python-rag-openai",
        "model": CHAT_MODEL,
        "embeddingModel": EMBED_MODEL,
        "ragRequestId": rag_id,
        "retrievalK": RETRIEVAL_K
    }

    return GenerateResponse(
        title=doc_dict["title"],
        startDate=doc_dict["startDate"],
        endDate=doc_dict["endDate"],
        planJson=json.dumps(doc_dict)
    )
