from typing import Optional
from pydantic import BaseModel, field_validator

_ALLOWED_STORES = {"TRADER_JOES", "WHOLE_FOODS"}


class Preferences(BaseModel):
    dietaryRestrictions: Optional[str] = None
    allergies: Optional[str] = None
    targetCaloriesPerDay: Optional[int] = None


class GenerateRequest(BaseModel):
    userId: int
    requestId: Optional[str] = None
    store: str
    days: int
    preferences: Preferences

    @field_validator("store")
    @classmethod
    def validate_store(cls, v: str) -> str:
        normalized = v.upper()
        if normalized not in _ALLOWED_STORES:
            raise ValueError(f"store must be one of {sorted(_ALLOWED_STORES)}")
        return normalized

class GenerateResponse(BaseModel):
    title: str
    startDate: str
    endDate: str
    planJson: str

class BackfillRequest(BaseModel):
    store: Optional[str] = None
    limit: int = 200

class BackfillResponse(BaseModel):
    updated: int
    skipped: int
