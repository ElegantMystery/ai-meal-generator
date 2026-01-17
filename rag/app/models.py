from typing import Optional
from pydantic import BaseModel

class Preferences(BaseModel):
    dietaryRestrictions: Optional[str] = None
    allergies: Optional[str] = None
    targetCaloriesPerDay: Optional[int] = None

class GenerateRequest(BaseModel):
    userId: int
    store: str
    days: int
    preferences: Preferences

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
