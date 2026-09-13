import os
from pathlib import Path
import urllib.request
from unittest.mock import MagicMock, patch

import pytest
import yaml
from fastapi import HTTPException

from app.main import readiness


def test_readiness_checks_database():
    connection = MagicMock()
    context = MagicMock()
    context.__enter__.return_value = connection

    with patch("app.main.get_conn", return_value=context):
        assert readiness() == {"status": "UP", "database": "UP"}

    connection.execute.assert_called_once_with("SELECT 1")


def test_readiness_fails_closed_without_leaking_database_error():
    with patch("app.main.get_conn", side_effect=RuntimeError("secret host details")):
        with pytest.raises(HTTPException) as error:
            readiness()

    assert error.value.status_code == 503
    assert error.value.detail == "RAG service is not ready"


def test_production_healthcheck_authenticates_readiness_request(monkeypatch):
    compose_path = Path(__file__).resolve().parents[2] / "docker-compose.prod.yml"
    compose = yaml.safe_load(compose_path.read_text())
    command = compose["services"]["python-rag"]["healthcheck"]["test"]
    expression = command[3]
    observed = {}

    def authenticated_urlopen(request, *, timeout=None):
        assert isinstance(request, urllib.request.Request)
        observed["url"] = request.full_url
        observed["secret"] = request.get_header("X-rag-secret")
        observed["timeout"] = timeout
        return MagicMock()

    monkeypatch.setenv("RAG_SHARED_SECRET", "healthcheck-test-secret")
    monkeypatch.setattr(urllib.request, "urlopen", authenticated_urlopen)

    exec(expression, {})

    assert observed == {
        "url": "http://localhost:8000/ready",
        "secret": os.environ["RAG_SHARED_SECRET"],
        "timeout": 3,
    }
