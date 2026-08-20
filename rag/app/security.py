"""Authentication boundary for backend-to-RAG requests."""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Header, HTTPException, status

from . import config

_NONPRODUCTION_ENVIRONMENTS = {"development", "test"}


def validate_security_configuration() -> None:
    """Reject an unprotected service unless non-production mode is explicit."""
    if config.RAG_SHARED_SECRET and config.RAG_SHARED_SECRET.strip():
        return
    if config.RAG_ENV not in _NONPRODUCTION_ENVIRONMENTS:
        raise RuntimeError(
            "RAG_SHARED_SECRET must be set when RAG_ENV is not development or test"
        )


async def require_rag_secret(
    presented_secret: Annotated[str | None, Header(alias="X-RAG-SECRET")] = None,
) -> None:
    """Authenticate a request without exposing an unconfigured service."""
    expected_secret = config.RAG_SHARED_SECRET
    if not expected_secret or not expected_secret.strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service authentication is not configured",
        )
    if presented_secret is None or not secrets.compare_digest(
        presented_secret, expected_secret
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
