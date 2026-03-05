# app/validators.py
import json
import logging
from typing import Dict, List, Literal, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)


class PlanItem(BaseModel):
    id: int
    name: str
    servingsUsed: float = Field(default=1.0, ge=0.05, le=20.0)


class Dish(BaseModel):
    dishName: str
    description: Optional[str] = None
    estimatedCalories: Optional[int] = None
    items: List[PlanItem] = Field(min_length=1, max_length=12)


class Meal(BaseModel):
    # Lock meal types so UI stays consistent
    name: Literal["Breakfast", "Lunch", "Dinner"]
    dishes: List[Dish] = Field(default_factory=list, min_length=1, max_length=5)
    items: List[PlanItem] = Field(default_factory=list, max_length=20)


class DayPlan(BaseModel):
    # Keep string to avoid timezone pitfalls; validate format in UI or add regex later
    date: str
    meals: List[Meal] = Field(min_length=0, max_length=3)


class PlanMeta(BaseModel):
    generatedBy: str
    model: str
    ragRequestId: str
    retrievalK: int
    embeddingModel: Optional[str] = None


class MealPlanDoc(BaseModel):
    title: str
    startDate: str
    endDate: str
    plan: List[DayPlan]
    _meta: Optional[PlanMeta] = None


def flatten_dishes_to_items(doc: MealPlanDoc) -> MealPlanDoc:
    """
    Post-process a MealPlanDoc after LLM generation:
    - For each meal, iterate all dishes and collect all items.
    - Deduplicate by item id, summing servingsUsed across dishes.
    - Set meal.items to the deduplicated list (preserves first-seen item name).
    - Backward compat: shopping list service walks meal.items and needs it populated.

    Returns the same doc (mutated in place) for convenience.
    """
    for day in doc.plan:
        for meal in day.meals:
            if not meal.dishes:
                # Nothing to flatten — leave items as-is (empty or pre-populated)
                continue

            # Collect deduplicated items from all dishes in this meal
            # Use raw dicts to accumulate servingsUsed without the per-dish le=10 cap
            seen_ids: Dict[int, str] = {}     # id -> name (first-seen)
            seen_used: Dict[int, float] = {}  # id -> total servingsUsed across dishes
            for dish in meal.dishes:
                for item in dish.items:
                    if item.id not in seen_ids:
                        seen_ids[item.id] = item.name
                    seen_used[item.id] = seen_used.get(item.id, 0.0) + item.servingsUsed

            meal.items = [
                PlanItem(id=iid, name=seen_ids[iid], servingsUsed=seen_used[iid])
                for iid in seen_ids
            ]

    return doc


def parse_and_validate_plan_json(content: str) -> MealPlanDoc:
    """
    Parse JSON text and validate against the strict schema.
    Throws HTTPException(500) with readable details if invalid.
    """
    if not content or not content.strip():
        raise HTTPException(status_code=500, detail="LLM returned empty response")

    try:
        raw = json.loads(content)
    except Exception:
        raise HTTPException(status_code=500, detail="LLM did not return valid JSON")

    try:
        return MealPlanDoc.model_validate(raw)
    except ValidationError as e:
        errors = e.errors()
        logger.error("LLM JSON schema validation failed: %s", errors[:5])
        raise HTTPException(
            status_code=500,
            detail={
                "message": "LLM JSON schema validation failed",
                "errors": errors[:5],
            },
        )


def extract_item_ids(doc: MealPlanDoc) -> List[int]:
    ids: List[int] = []
    for day in doc.plan:
        for meal in day.meals:
            for it in meal.items:
                ids.append(it.id)
    return ids
