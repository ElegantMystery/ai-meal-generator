"""Stable, user-safe error contract for streamed meal-plan generation."""

from __future__ import annotations

import asyncio
from enum import StrEnum
from typing import Any

from anthropic import APIError, APITimeoutError
from psycopg import Error as DatabaseError
from pydantic import ValidationError


class GenerationErrorCode(StrEnum):
    CONFIGURATION = "GENERATION_CONFIGURATION_ERROR"
    PROVIDER = "GENERATION_PROVIDER_UNAVAILABLE"
    DATABASE = "GENERATION_DATABASE_UNAVAILABLE"
    VALIDATION = "GENERATION_VALIDATION_FAILED"
    TIMEOUT = "GENERATION_TIMEOUT"
    INTERNAL = "GENERATION_INTERNAL_ERROR"


_MESSAGES = {
    GenerationErrorCode.CONFIGURATION: "Meal plan generation is temporarily unavailable.",
    GenerationErrorCode.PROVIDER: "The meal planner is temporarily unavailable. Please try again.",
    GenerationErrorCode.DATABASE: "Meal data is temporarily unavailable. Please try again.",
    GenerationErrorCode.VALIDATION: "The generated meal plan was invalid. Please try again.",
    GenerationErrorCode.TIMEOUT: "Meal plan generation timed out. Please try again.",
    GenerationErrorCode.INTERNAL: "Meal plan generation failed. Please try again.",
}


def classify_generation_error(exc: BaseException) -> GenerationErrorCode:
    if isinstance(exc, (APITimeoutError, asyncio.TimeoutError, TimeoutError)):
        return GenerationErrorCode.TIMEOUT
    if isinstance(exc, APIError):
        return GenerationErrorCode.PROVIDER
    if isinstance(exc, DatabaseError):
        return GenerationErrorCode.DATABASE
    if isinstance(exc, (ValidationError, ValueError)):
        return GenerationErrorCode.VALIDATION
    return GenerationErrorCode.INTERNAL


def public_error(code: GenerationErrorCode, request_id: str) -> dict[str, Any]:
    return {
        "code": code.value,
        "message": _MESSAGES[code],
        "requestId": request_id,
    }
