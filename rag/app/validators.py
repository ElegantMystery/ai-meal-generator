# app/validators.py
import json
from typing import List, Literal, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError


class PlanItem(BaseModel):
    id: int
    name: str


class Meal(BaseModel):
    # Lock meal types so UI stays consistent
    name: Literal["Breakfast", "Lunch", "Dinner"]
    items: List[PlanItem] = Field(min_length=1, max_length=8)


class DayPlan(BaseModel):
    # Keep string to avoid timezone pitfalls; validate format in UI or add regex later
    date: str
    meals: List[Meal] = Field(min_length=3, max_length=3)


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
        # Keep it short; too many errors gets noisy
        errors = e.errors()
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
