from __future__ import annotations

import asyncio
import json

from app.models import GenerateRequest, Preferences
from app.routes import generate_routes


def _request() -> GenerateRequest:
    return GenerateRequest(
        userId=1,
        requestId="backend-request-123",
        store="TRADER_JOES",
        days=1,
        preferences=Preferences(),
    )


def test_agent_stream_sanitizes_unexpected_escape(monkeypatch):
    async def crashing_agent(_req):
        if False:
            yield None
        raise RuntimeError("raw internal secret")

    monkeypatch.setattr(generate_routes, "run_agent", crashing_agent)

    async def collect():
        return [frame async for frame in generate_routes._agent_stream(_request())]

    frames = asyncio.run(collect())
    data = json.loads(frames[-1].split("data: ", 1)[1])
    assert data == {
        "code": "GENERATION_INTERNAL_ERROR",
        "message": "Meal plan generation failed. Please try again.",
        "requestId": "backend-request-123",
    }
    assert "secret" not in frames[-1]


def test_generate_exposes_same_request_id_in_response_header():
    request = _request()
    response = asyncio.run(generate_routes.generate(request))
    assert response.headers["x-request-id"] == "backend-request-123"
