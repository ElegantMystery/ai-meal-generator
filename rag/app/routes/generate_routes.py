import json
import logging
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from ..models import GenerateRequest, GenerateResponse
from ..config import RAG_SHARED_SECRET
from ..retrieval import retrieve_candidates
from ..llm import call_mealplan_llm, get_dish_system_prompt
from ..validators import (
    flatten_dishes_to_items,
    parse_and_validate_plan_json,
    extract_item_ids,
)
from ..verify import verify_item_ids_belong_to_store
from ..config import CHAT_MODEL, EMBED_MODEL, RETRIEVAL_K

logger = logging.getLogger(__name__)
router = APIRouter(tags=["generate"])


def auth(secret: Optional[str]):
    if RAG_SHARED_SECRET and secret != RAG_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _log_serving_waste(doc, candidates: list) -> None:
    """
    Tally servingsUsed per item across the whole plan.
    Log a WARNING for items used < 50% of their serving_count.
    """
    # Build a lookup: item_id -> serving_count from the candidate list
    serving_counts: dict[int, int] = {}
    for c in candidates:
        item_id = c.get("id")
        nutrition = c.get("nutrition") or {}
        sc = nutrition.get("serving_count")
        if item_id is not None and sc is not None:
            try:
                serving_counts[int(item_id)] = int(sc)
            except (ValueError, TypeError):
                pass

    # Tally total servingsUsed per item across all days/meals/dishes
    used_tally: dict[int, int] = {}
    name_lookup: dict[int, str] = {}
    for day in doc.plan:
        for meal in day.meals:
            for dish in meal.dishes:
                for item in dish.items:
                    used_tally[item.id] = used_tally.get(item.id, 0) + item.servingsUsed
                    name_lookup[item.id] = item.name

    # Warn for under-utilised items (used < 50% of serving_count)
    for item_id, used in used_tally.items():
        sc = serving_counts.get(item_id)
        if sc and sc > 0:
            utilisation = used / sc
            if utilisation < 0.5:
                logger.warning(
                    "Serving waste: item_id=%d ('%s') used %d/%d servings (%.0f%% utilisation)",
                    item_id,
                    name_lookup.get(item_id, "?"),
                    used,
                    sc,
                    utilisation * 100,
                )


@router.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest, x_rag_secret: Optional[str] = Header(default=None)):
    auth(x_rag_secret)

    if req.days < 1 or req.days > 14:
        raise HTTPException(status_code=400, detail="days must be between 1 and 14")

    candidates = retrieve_candidates(req.store)

    if not candidates:
        raise HTTPException(
            status_code=400, detail="No embedded items found. Run /embed/backfill first."
        )

    start = date.today()

    system = get_dish_system_prompt()

    prefs_dict = req.preferences.model_dump() if req.preferences else {}
    payload = {
        "store": req.store,
        "days": req.days,
        "startDate": str(start),
        "preferences": prefs_dict,
        "items": candidates,
    }

    logger.info("OpenAI API input - System: %s", system)
    logger.info("OpenAI API input - Number of candidates: %d", len(candidates))

    content = call_mealplan_llm(system, payload, temperature=0.7)
    if not content:
        raise HTTPException(status_code=500, detail="LLM returned empty response")

    rag_id = str(uuid.uuid4())

    doc = parse_and_validate_plan_json(content)

    # Populate meal.items from dishes (deduplicates + sums servingsUsed)
    doc = flatten_dishes_to_items(doc)

    # Log waste utilisation warnings
    _log_serving_waste(doc, candidates)

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
        "retrievalK": RETRIEVAL_K,
    }

    return GenerateResponse(
        title=doc_dict["title"],
        startDate=doc_dict["startDate"],
        endDate=doc_dict["endDate"],
        planJson=json.dumps(doc_dict),
    )
