"""
/generate -- agentic meal plan generation, streamed as SSE.

The agent loop emits semantic events (`phase`, `tool_call`, `tool_result`,
`assistant_text`) and a single terminal event (`complete` with the plan
JSON, or `error`).
"""
import json
import logging
from typing import AsyncIterator, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from ..agent.runner import run_agent
from ..config import RAG_SHARED_SECRET
from ..models import GenerateRequest

logger = logging.getLogger(__name__)
router = APIRouter(tags=["generate"])


def auth(secret: Optional[str]):
    if RAG_SHARED_SECRET and secret != RAG_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _sse_frame(event: str, data: dict) -> str:
    """Format one Server-Sent-Events frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _agent_stream(req: GenerateRequest) -> AsyncIterator[str]:
    """Translate runner events into SSE frames."""
    try:
        async for event_name, data in run_agent(req):
            logger.info("SSE event: %s | %s", event_name, str(data)[:200])
            yield _sse_frame(event_name, data)
    except Exception as e:
        logger.exception("Agent stream crashed")
        yield _sse_frame("error", {"code": "stream_crashed", "message": str(e)})


@router.post("/generate")
async def generate(
    req: GenerateRequest,
    x_rag_secret: Optional[str] = Header(default=None),
):
    auth(x_rag_secret)

    if req.days < 1 or req.days > 14:
        raise HTTPException(status_code=400, detail="days must be between 1 and 14")

    return StreamingResponse(
        _agent_stream(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx response buffering for SSE
        },
    )
