import asyncio
import json

import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from app import config
from app.models import GenerateRequest, Preferences
from app.routes.generate_routes import router


async def _post_status(app: FastAPI, body: dict) -> int:
    sent = False
    messages = []

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {
                "type": "http.request",
                "body": json.dumps(body).encode(),
                "more_body": False,
            }
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/generate",
            "raw_path": b"/generate",
            "query_string": b"",
            "headers": [
                (b"content-type", b"application/json"),
                (b"x-rag-secret", b"test-secret"),
            ],
            "client": ("test", 1234),
            "server": ("test", 80),
        },
        receive,
        send,
    )
    return next(
        message["status"]
        for message in messages
        if message["type"] == "http.response.start"
    )


def _request(**overrides):
    values = {
        "userId": 1,
        "store": "TRADER_JOES",
        "days": 3,
        "preferences": Preferences(),
    }
    values.update(overrides)
    return GenerateRequest(**values)


def test_generate_request_defaults_to_one_serving():
    assert _request().servings == 1


@pytest.mark.parametrize("servings", [1, 2, 12])
def test_generate_request_accepts_servings_in_supported_range(servings):
    assert _request(servings=servings).servings == servings


@pytest.mark.parametrize(
    "servings",
    [0, 13, -1, 1.5, 2.0, "2", True, False],
    ids=[
        "zero",
        "above-max",
        "negative",
        "fraction",
        "float",
        "string",
        "true",
        "false",
    ],
)
def test_generate_request_rejects_invalid_servings(servings):
    with pytest.raises(ValidationError):
        _request(servings=servings)


@pytest.mark.parametrize("servings", [True, "2", 2.0])
def test_generate_route_rejects_non_integer_json_servings(servings, monkeypatch):
    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "test-secret")
    app = FastAPI()
    app.include_router(router)

    status = asyncio.run(
        _post_status(
            app,
            {
                "userId": 1,
                "store": "TRADER_JOES",
                "days": 1,
                "servings": servings,
                "preferences": {},
            },
        )
    )

    assert status == 422
