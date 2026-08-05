"""
Agent runner: hand-rolled Anthropic tool-use loop, exposed as an async
generator that yields semantic events for SSE forwarding.

Event shape: (event_name, data_dict). The route layer serialises these
to SSE frames. The terminal events are 'complete' and 'error'.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from anthropic import Anthropic, APIError

from .. import config
from ..models import GenerateRequest
from .prompt import SYSTEM_PROMPT
from .tools import TOOL_DEFINITIONS, ToolContext, dispatch

logger = logging.getLogger(__name__)

Event = Tuple[str, Dict[str, Any]]

# Phase heuristic: name each phase off the first qualifying tool call.
_PHASE_DISCOVER_TOOLS = {"list_categories", "search_items", "list_recipes"}
_PHASE_SELECT_TOOLS = {"get_item_details"}
_PHASE_VALIDATE_TOOLS = {"validate_item_ids"}
_PHASE_SUBMIT_TOOLS = {"submit_plan"}

# MiniMax-M3 sometimes emits tool calls as XML text instead of native tool_use blocks.
# Closed form (preferred when complete) and open form (when truncated by max_tokens).
_XML_INVOKE_OPEN_RE = re.compile(r'<invoke\s+name="([^"]+)">', re.DOTALL)
_XML_PARAM_RE = re.compile(r'<parameter\s+name="([^"]+)">(.*?)(?:</parameter>|$)', re.DOTALL)


def _parse_xml_tool_calls(text: str) -> List[Any]:
    """
    Parse <minimax:tool_call> XML from assistant text into synthetic block objects.
    Tolerates unclosed tags from max_tokens truncation by parsing greedily from the
    last <invoke ...> opening to end of text.
    """
    blocks = []
    for m in _XML_INVOKE_OPEN_RE.finditer(text):
        tool_name = m.group(1)
        body_start = m.end()
        # Find the matching </invoke>, or take everything until end of text.
        close_idx = text.find("</invoke>", body_start)
        body = text[body_start:close_idx if close_idx != -1 else len(text)]
        args: Dict[str, Any] = {}
        for p in _XML_PARAM_RE.finditer(body):
            val = p.group(2).strip()
            try:
                args[p.group(1)] = json.loads(val)
            except json.JSONDecodeError:
                # Salvage truncated JSON by attempting to close it. Best-effort.
                args[p.group(1)] = _try_repair_truncated_json(val)
        if args:  # only emit if we got at least one parameter
            fake_id = f"toolu_{uuid.uuid4().hex[:20]}"
            blocks.append(SimpleNamespace(type="tool_use", id=fake_id, name=tool_name, input=args))
    return blocks


def _try_repair_truncated_json(s: str) -> Any:
    """
    Best-effort: if the model's JSON got cut off by max_tokens, try closing it.
    Returns parsed object on success, raw string on failure.
    """
    s = s.strip()
    if not s:
        return s
    # Try the original first
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # Count braces/brackets and try appending closures
    open_braces = s.count("{") - s.count("}")
    open_brackets = s.count("[") - s.count("]")
    # Cut off after the last comma to drop a partial trailing value
    last_comma = s.rfind(",")
    last_brace = s.rfind("}")
    last_bracket = s.rfind("]")
    cut = max(last_comma, last_brace, last_bracket)
    if cut > 0:
        candidate = s[:cut].rstrip(", \n\t")
        # Recount after cut
        ob = candidate.count("{") - candidate.count("}")
        obk = candidate.count("[") - candidate.count("]")
        closer = "]" * obk + "}" * ob
        try:
            return json.loads(candidate + closer)
        except json.JSONDecodeError:
            pass
    # Last attempt: append closers to original
    try:
        return json.loads(s + "]" * open_brackets + "}" * open_braces)
    except json.JSONDecodeError:
        return s


def _normalize_blocks(content: List[Any]) -> List[Any]:
    """
    Replace <minimax:tool_call> XML text blocks with synthetic tool_use blocks so the
    rest of the loop treats them identically to native tool_use blocks.
    """
    result = []
    for block in content:
        if block.type == "text":
            synthetic = _parse_xml_tool_calls(block.text)
            if synthetic:
                logger.warning(
                    "MiniMax XML tool_call fallback: replacing text block with %d synthetic tool_use block(s)",
                    len(synthetic),
                )
                result.extend(synthetic)
            else:
                result.append(block)
        else:
            result.append(block)
    return result


def _block_to_dict(block: Any) -> Dict[str, Any]:
    """Serialise a content block (real or synthetic) to a messages-array dict."""
    if hasattr(block, "model_dump"):
        return block.model_dump()
    # SimpleNamespace synthetic block
    d: Dict[str, Any] = {"type": block.type}
    if block.type == "tool_use":
        d.update({"id": block.id, "name": block.name, "input": block.input})
    elif block.type == "text":
        d["text"] = block.text
    return d


def _summarise_tool_result(name: str, result: Dict[str, Any]) -> str:
    """One-line human-friendly summary of a tool result for SSE."""
    if "error" in result:
        return f"error: {result['error']}"
    if name == "list_categories":
        return f"{len(result.get('categories', []))} categories"
    if name == "search_items":
        return f"found {result.get('count', 0)} items in '{result.get('category', '?')}'"
    if name == "get_item_details":
        return f"details for item {result.get('id', '?')} ({result.get('name', '')[:40]})"
    if name == "list_recipes":
        return f"{result.get('count', 0)} recipe ideas"
    if name == "validate_item_ids":
        missing = result.get("missing") or []
        return f"valid={len(result.get('valid', []))} missing={len(missing)}"
    if name == "submit_plan":
        if result.get("ok"):
            return "plan accepted"
        return f"rejected ({len(result.get('errors', []))} errors)"
    return "ok"


def _phase_for_tool(name: str) -> Optional[str]:
    if name in _PHASE_DISCOVER_TOOLS:
        return "discover"
    if name in _PHASE_SELECT_TOOLS:
        return "select"
    if name in _PHASE_VALIDATE_TOOLS:
        return "validate"
    if name in _PHASE_SUBMIT_TOOLS:
        return "submit"
    return None


def _phase_message(phase: str) -> str:
    return {
        "discover": "Exploring store inventory and recipe ideas",
        "select": "Choosing items for each dish",
        "validate": "Checking item ids before submitting",
        "submit": "Submitting the meal plan",
        "repair": "Fixing the plan and resubmitting",
    }.get(phase, phase)


def _arg_summary(name: str, args: Dict[str, Any]) -> str:
    """Short string for the SSE 'args' field — avoid leaking full payloads."""
    if name == "search_items":
        return f"category='{args.get('category', '')}' limit={args.get('limit', 15)}"
    if name == "get_item_details":
        return f"item_id={args.get('item_id')}"
    if name == "list_recipes":
        parts = [f"limit={args.get('limit', 12)}"]
        if args.get("dietary_restriction"):
            parts.append(f"diet={args['dietary_restriction']}")
        if args.get("cuisine"):
            parts.append(f"cuisine={args['cuisine']}")
        return " ".join(parts)
    if name == "validate_item_ids":
        ids = args.get("item_ids") or []
        return f"{len(ids)} ids"
    if name == "submit_plan":
        plan = args.get("plan_json") or {}
        days = len(plan.get("plan", [])) if isinstance(plan, dict) else 0
        return f"{days} days"
    return ""


async def _handle_tool_block(
    block: Any, ctx: ToolContext, current_phase: Optional[str]
) -> Tuple[List[Event], Dict[str, Any], Optional[str]]:
    """Process one tool_use block. Returns (events, tool_result, updated_phase)."""
    events: List[Event] = []
    tool_name = block.name
    tool_args = block.input or {}

    phase = _phase_for_tool(tool_name)
    if phase == "submit" and ctx.repair_attempted:
        if current_phase != "repair":
            current_phase = "repair"
            events.append(("phase", {"phase": "repair", "message": _phase_message("repair")}))
    elif phase and phase != current_phase:
        current_phase = phase
        events.append(("phase", {"phase": phase, "message": _phase_message(phase)}))

    events.append(("tool_call", {"name": tool_name, "args": _arg_summary(tool_name, tool_args)}))

    # Tools are sync DB-bound work; run in a thread to keep the loop async-friendly.
    result = await asyncio.to_thread(dispatch, tool_name, tool_args, ctx)

    events.append(("tool_result", {"name": tool_name, "summary": _summarise_tool_result(tool_name, result)}))

    tool_result = {
        "type": "tool_result",
        "tool_use_id": block.id,
        "content": json.dumps(result),
    }
    return events, tool_result, current_phase


async def _process_turn(
    content: List[Any], stop_reason: str, ctx: ToolContext, current_phase: Optional[str]
) -> Tuple[List[Event], List[Dict[str, Any]], Optional[str], bool]:
    """
    Process one full assistant turn (already normalised content).
    Returns (events, tool_results, updated_phase, should_stop).
    """
    events: List[Event] = []
    tool_results: List[Dict[str, Any]] = []

    for block in content:
        if block.type == "text":
            text = block.text.strip()
            if text:
                events.append(("assistant_text", {"text": text[:500]}))
        elif block.type == "tool_use":
            block_events, tool_result, current_phase = await _handle_tool_block(
                block, ctx, current_phase
            )
            events.extend(block_events)
            tool_results.append(tool_result)

    should_stop = stop_reason == "end_turn" or not tool_results
    return events, tool_results, current_phase, should_stop


async def run_agent(req: GenerateRequest) -> AsyncIterator[Event]:
    """
    Drive the agent loop. Yields (event_name, data) tuples.

    Terminal events:
      - ('complete', {title, startDate, endDate, planJson})
      - ('error', {code, message})
    """
    if not config.MINIMAX_API_KEY:
        yield ("error", {"code": "config", "message": "MINIMAX_API_KEY not set"})
        return

    prefs = req.preferences.model_dump() if req.preferences else {}
    start = date.today()
    end = start + timedelta(days=req.days - 1)
    rag_id = str(uuid.uuid4())

    ctx = ToolContext(
        store=req.store,
        days=req.days,
        start_date=str(start),
        dietary_restriction=prefs.get("dietaryRestrictions"),
    )

    user_brief = {
        "store": req.store,
        "days": req.days,
        "startDate": str(start),
        "endDate": str(end),
        "preferences": prefs,
    }

    messages: List[Dict[str, Any]] = [
        {
            "role": "user",
            "content": (
                "Build a meal plan for this user using your tools. "
                "Use the JSON below as the brief, then DISCOVER -> SELECT -> SUBMIT. "
                "Call submit_plan with the final plan when ready.\n\n"
                f"```json\n{json.dumps(user_brief, indent=2)}\n```"
            ),
        }
    ]

    client = Anthropic()  # picks up ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL from env
    current_phase: Optional[str] = None
    turns_used = 0

    yield ("phase", {"phase": "starting", "message": "Connecting to the planner"})

    for turn in range(config.AGENT_MAX_TURNS):
        turns_used = turn + 1
        try:
            resp = await asyncio.to_thread(
                client.messages.create,
                model=config.AGENT_MODEL,
                max_tokens=16384,
                system=SYSTEM_PROMPT,
                tools=TOOL_DEFINITIONS,
                messages=messages,
            )
        except APIError as e:
            yield ("error", {"code": "anthropic_api_error", "message": f"{type(e).__name__}: {e}"})
            return
        except Exception as e:
            yield ("error", {"code": "agent_loop_failure", "message": str(e)})
            return

        # Normalise: replace any XML text tool calls with synthetic tool_use blocks.
        content = _normalize_blocks(resp.content)
        logger.info(
            "Turn %d: stop_reason=%s blocks=%s",
            turns_used, resp.stop_reason,
            [(b.type, getattr(b, "name", None) or getattr(b, "text", "")[:80]) for b in content],
        )
        messages.append({"role": "assistant", "content": [_block_to_dict(b) for b in content]})

        turn_events, tool_results, current_phase, should_stop = await _process_turn(
            content, resp.stop_reason, ctx, current_phase
        )
        for event in turn_events:
            yield event

        if should_stop:
            break

        messages.append({"role": "user", "content": tool_results})

    if not ctx.submitted or ctx.plan_doc is None:
        yield (
            "error",
            {
                "code": "no_plan_submitted",
                "message": "Agent loop ended without a valid plan",
                "turnsUsed": turns_used,
                "toolCalls": ctx.tool_call_count,
            },
        )
        return

    doc_dict = ctx.plan_doc.model_dump()
    doc_dict["_meta"] = {
        "generatedBy": "python-rag-agent",
        "agentModel": config.AGENT_MODEL,
        "ragRequestId": rag_id,
        "turnsUsed": turns_used,
        "toolCallCount": ctx.tool_call_count,
    }

    yield (
        "complete",
        {
            "title": doc_dict["title"],
            "startDate": doc_dict["startDate"],
            "endDate": doc_dict["endDate"],
            "planJson": json.dumps(doc_dict),
        },
    )
