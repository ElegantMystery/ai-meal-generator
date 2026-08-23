"""
/generate -- agentic meal plan generation, streamed as SSE.

The agent loop emits semantic events (`phase`, `tool_call`, `tool_result`,
`assistant_text`) and a single terminal event (`complete` with the plan
JSON, or `error`).
"""
import json
import logging
import uuid
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..agent.runner import run_agent
from ..generation_errors import classify_generation_error, public_error
from ..models import GenerateRequest
from ..security import require_rag_secret

logger = logging.getLogger(__name__)
router = APIRouter(tags=["generate"], dependencies=[Depends(require_rag_secret)])


def _sse_frame(event: str, data: dict) -> str:
    """Format one Server-Sent-Events frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _agent_stream(req: GenerateRequest) -> AsyncIterator[str]:
    """Translate runner events into SSE frames."""
    request_id = req.requestId or str(uuid.uuid4())
    correlation_id = req.correlationId or request_id
    req.requestId = request_id
    try:
        async for event_name, data in run_agent(req):
            logger.info("SSE event=%s correlationId=%s", event_name, correlation_id)
            yield _sse_frame(event_name, data)
    except Exception as e:
        code = classify_generation_error(e)
        logger.error("generation_failed code=%s requestId=%s correlationId=%s errorType=%s",
                     code, request_id, correlation_id, type(e).__name__)
        yield _sse_frame("error", public_error(code, request_id))


@router.post("/generate")
async def generate(req: GenerateRequest):
    if req.days < 1 or req.days > 14:
        raise HTTPException(status_code=400, detail="days must be between 1 and 14")

    request_id = req.requestId or str(uuid.uuid4())
    req.requestId = request_id
    return StreamingResponse(
        _agent_stream(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx response buffering for SSE
            "X-Request-ID": request_id,
            "X-Correlation-ID": req.correlationId or request_id,
        },
    )
