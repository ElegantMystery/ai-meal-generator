from unittest.mock import MagicMock, patch

import pytest
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
