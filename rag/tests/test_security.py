from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app import config


def _authenticate(secret: str | None) -> None:
    from app.security import require_rag_secret

    asyncio.run(require_rag_secret(secret))


async def _request_app(app, path, body=None, headers=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if body is not None:
            return await client.post(path, json=body, headers=headers)
        return await client.get(path, headers=headers)


def test_production_startup_rejects_missing_secret(monkeypatch):
    from app.security import validate_security_configuration

    monkeypatch.setattr(config, "RAG_ENV", "production")
    monkeypatch.setattr(config, "RAG_SHARED_SECRET", None)

    with pytest.raises(RuntimeError, match="RAG_SHARED_SECRET"):
        validate_security_configuration()


def test_production_startup_rejects_blank_secret(monkeypatch):
    from app.security import validate_security_configuration

    monkeypatch.setattr(config, "RAG_ENV", "production")
    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "   ")

    with pytest.raises(RuntimeError, match="RAG_SHARED_SECRET"):
        validate_security_configuration()


@pytest.mark.parametrize("environment", ["development", "test"])
def test_explicit_nonproduction_mode_can_start_without_secret(monkeypatch, environment):
    from app.security import validate_security_configuration

    monkeypatch.setattr(config, "RAG_ENV", environment)
    monkeypatch.setattr(config, "RAG_SHARED_SECRET", None)

    validate_security_configuration()


def test_production_startup_accepts_configured_secret(monkeypatch):
    from app.security import validate_security_configuration

    monkeypatch.setattr(config, "RAG_ENV", "production")
    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "a-strong-shared-secret")

    validate_security_configuration()


def test_application_lifespan_validates_security_before_database(monkeypatch):
    monkeypatch.setattr(config, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(config, "RAG_ENV", "production")
    monkeypatch.setattr(config, "RAG_SHARED_SECRET", None)

    from app import main

    init_pool = MagicMock()
    monkeypatch.setattr(main, "init_pool", init_pool)

    async def _start_application():
        async with main.lifespan(main.app):
            pass

    with pytest.raises(RuntimeError, match="RAG_SHARED_SECRET"):
        asyncio.run(_start_application())

    init_pool.assert_not_called()


def test_generation_and_embedding_routes_share_fail_closed_auth(monkeypatch):
    monkeypatch.setattr(config, "OPENAI_API_KEY", "test-key")
    from app.routes.embed_routes import router as embed_router
    from app.routes.generate_routes import router as generate_router
    from app.security import require_rag_secret

    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "expected-secret")

    assert generate_router.dependencies[0].dependency is require_rag_secret
    assert embed_router.dependencies[0].dependency is require_rag_secret
    for router in (generate_router, embed_router):
        for route in router.routes:
            dependency = route.dependant.dependencies[0]
            assert dependency.call is require_rag_secret
            assert [header.alias for header in dependency.header_params] == [
                "X-RAG-SECRET"
            ]
    with pytest.raises(HTTPException) as exc_info:
        _authenticate(None)
    assert exc_info.value.status_code == 401


def test_readiness_route_uses_shared_fail_closed_auth():
    from app.main import app
    from app.security import require_rag_secret

    readiness_route = next(route for route in app.routes if route.path == "/ready")

    assert [dependency.call for dependency in readiness_route.dependant.dependencies] == [
        require_rag_secret
    ]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (
            "/generate",
            {
                "userId": 1,
                "store": "TRADER_JOES",
                "days": 1,
                "preferences": {},
            },
        ),
        ("/embed/backfill/items", {"store": "TRADER_JOES", "limit": 1}),
        ("/embed/backfill/nutrition", {"store": "TRADER_JOES", "limit": 1}),
        ("/embed/backfill/ingredients", {"store": "TRADER_JOES", "limit": 1}),
        ("/ready", None),
    ],
)
@pytest.mark.parametrize("provided_secret", [None, "wrong-secret"])
def test_protected_routes_reject_missing_or_incorrect_secret(
    monkeypatch, path, body, provided_secret
):
    from app import main

    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "expected-secret")
    get_conn = MagicMock()
    monkeypatch.setattr(main, "get_conn", get_conn)
    headers = {"X-RAG-SECRET": provided_secret} if provided_secret else {}
    response = asyncio.run(_request_app(main.app, path, body, headers))

    assert response.status_code == 401
    get_conn.assert_not_called()


def test_health_remains_public_when_rag_authentication_is_configured(monkeypatch):
    from app import main

    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "expected-secret")
    health_route = next(route for route in main.app.routes if route.path == "/health")

    assert health_route.dependant.dependencies == []
    assert main.health() == {"ok": True}


def test_readiness_accepts_valid_secret_and_checks_database(monkeypatch):
    from app import main

    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "expected-secret")
    connection = MagicMock()
    context = MagicMock()
    context.__enter__.return_value = connection
    get_conn = MagicMock(return_value=context)
    monkeypatch.setattr(main, "get_conn", get_conn)

    _authenticate("expected-secret")
    response = main.readiness()

    assert response == {"status": "UP", "database": "UP"}
    connection.execute.assert_called_once_with("SELECT 1")


def test_valid_secret_uses_constant_time_comparison(monkeypatch):
    from app.security import require_rag_secret

    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "expected-secret")

    with patch("app.security.secrets.compare_digest", return_value=True) as compare_digest:
        _authenticate("expected-secret")

    compare_digest.assert_called_once_with("expected-secret", "expected-secret")


def test_invalid_secret_is_unauthorized_after_constant_time_comparison(monkeypatch):
    from app.security import require_rag_secret

    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "expected-secret")

    with patch("app.security.secrets.compare_digest", return_value=False) as compare_digest:
        with pytest.raises(HTTPException) as exc_info:
            _authenticate("wrong-secret")

    assert exc_info.value.status_code == 401
    compare_digest.assert_called_once_with("wrong-secret", "expected-secret")


def test_missing_configured_secret_rejects_every_request(monkeypatch):
    from app.security import require_rag_secret

    monkeypatch.setattr(config, "RAG_SHARED_SECRET", "")

    with pytest.raises(HTTPException) as exc_info:
        _authenticate("anything")
    assert exc_info.value.status_code == 503
