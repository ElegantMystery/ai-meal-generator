"""
Tests for rag/app/agent/runner.py.

The Anthropic SDK is fully mocked. We script a sequence of responses to
exercise: discover -> select -> submit (happy), submit-then-repair, and
max-turns failure.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest

from app.agent import runner as runner_mod
from app.agent.runner import run_agent
from app.models import GenerateRequest, Preferences


@pytest.fixture(autouse=True)
def _run_mocked_thread_calls_inline(monkeypatch):
    """Keep state-machine tests deterministic without a real thread pool.

    The production runner offloads the blocking SDK and database calls. These
    tests replace both call targets with in-memory mocks, so a worker thread
    adds no coverage and can leave the synchronous asyncio harness waiting for
    an executor callback during interpreter/plugin shutdown.
    """

    async def _inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(runner_mod.asyncio, "to_thread", _inline)


# ---------------------------------------------------------------------------
# Fake Anthropic message shapes
# ---------------------------------------------------------------------------


@dataclass
class _FakeBlock:
    type: str
    text: str | None = None
    name: str | None = None
    input: Dict[str, Any] | None = None
    id: str | None = None

    def model_dump(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"type": self.type}
        if self.text is not None:
            d["text"] = self.text
        if self.name is not None:
            d["name"] = self.name
        if self.input is not None:
            d["input"] = self.input
        if self.id is not None:
            d["id"] = self.id
        return d


@dataclass
class _FakeResponse:
    content: List[_FakeBlock]
    stop_reason: str = "tool_use"


def _text(text: str) -> _FakeBlock:
    return _FakeBlock(type="text", text=text)


def _tool(name: str, args: Dict[str, Any], block_id: str | None = None) -> _FakeBlock:
    return _FakeBlock(
        type="tool_use",
        name=name,
        input=args,
        id=block_id or f"toolu_{name}",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_req() -> GenerateRequest:
    return GenerateRequest(
        userId=1,
        store="TRADER_JOES",
        days=1,
        preferences=Preferences(),
    )


def _collect_sync(req: GenerateRequest):
    """Run the async generator to completion and return list[(event, data)]."""
    async def _gather():
        return [ev async for ev in run_agent(req)]
    return asyncio.run(_gather())


def _captured_plan_doc():
    """Return the same minimal-plan dict the agent will pass to submit_plan."""
    return {
        "title": "Test Plan",
        "startDate": "2026-05-12",
        "endDate": "2026-05-12",
        "plan": [
            {
                "date": "2026-05-12",
                "meals": [
                    {
                        "name": "Lunch",
                        "dishes": [
                            {
                                "dishName": "Salad",
                                "items": [
                                    {"id": 1, "name": "Lettuce", "servingsUsed": 1.0},
                                    {"id": 2, "name": "Tomato", "servingsUsed": 0.3},
                                    {"id": 3, "name": "Olive Oil", "servingsUsed": 0.2},
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_run_agent_aborts_when_minimax_key_missing(monkeypatch):
    monkeypatch.setattr(runner_mod.config, "MINIMAX_API_KEY", None)
    events = _collect_sync(_make_req())
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "config"


def test_run_agent_happy_path_emits_complete(monkeypatch):
    monkeypatch.setattr(runner_mod.config, "MINIMAX_API_KEY", "fake-key")
    monkeypatch.setattr(runner_mod.config, "AGENT_MAX_TURNS", 5)

    plan = _captured_plan_doc()
    responses = [
        # Turn 0: agent uses a tool
        _FakeResponse(
            content=[_text("Let me look around."), _tool("list_categories", {})],
            stop_reason="tool_use",
        ),
        # Turn 1: agent submits the plan
        _FakeResponse(
            content=[_tool("submit_plan", {"plan_json": plan})],
            stop_reason="tool_use",
        ),
        # Turn 2: agent acknowledges success and ends the turn
        _FakeResponse(content=[_text("Done!")], stop_reason="end_turn"),
    ]

    # Mock tool dispatch so the DB is never hit
    def _fake_dispatch(name, args, ctx):
        ctx.tool_call_count += 1
        if name == "list_categories":
            return {"store": "TRADER_JOES", "categories": [{"category": "Produce", "approx_item_count": 50}]}
        if name == "submit_plan":
            # Mimic the real submit_plan: capture the doc onto ctx and return ok
            from app.validators import MealPlanDoc
            ctx.plan_doc = MealPlanDoc.model_validate(args["plan_json"])
            ctx.submitted = True
            return {"ok": True}
        return {"error": "unexpected tool"}

    with patch.object(runner_mod, "dispatch", _fake_dispatch):
        fake_client = MagicMock()
        fake_client.messages.create.side_effect = responses
        with patch.object(runner_mod, "Anthropic", return_value=fake_client):
            events = _collect_sync(_make_req())

    event_names = [e[0] for e in events]
    assert "complete" in event_names
    assert event_names[-1] == "complete"
    complete = next(d for n, d in events if n == "complete")
    assert complete["title"] == "Test Plan"
    assert "planJson" in complete


def test_run_agent_emits_repair_phase_on_resubmit(monkeypatch):
    monkeypatch.setattr(runner_mod.config, "MINIMAX_API_KEY", "fake-key")
    monkeypatch.setattr(runner_mod.config, "AGENT_MAX_TURNS", 6)

    plan = _captured_plan_doc()
    responses = [
        _FakeResponse(content=[_tool("search_items", {"category": "produce"})], stop_reason="tool_use"),
        _FakeResponse(content=[_tool("submit_plan", {"plan_json": {"title": "bad"}})], stop_reason="tool_use"),
        _FakeResponse(content=[_tool("submit_plan", {"plan_json": plan})], stop_reason="tool_use"),
        _FakeResponse(content=[_text("Fixed and submitted.")], stop_reason="end_turn"),
    ]

    submit_calls = {"n": 0}

    def _fake_dispatch(name, args, ctx):
        ctx.tool_call_count += 1
        if name == "search_items":
            return {"items": [], "count": 0, "category": "produce"}
        if name == "submit_plan":
            submit_calls["n"] += 1
            if submit_calls["n"] == 1:
                ctx.repair_attempted = True
                return {"ok": False, "errors": ["schema error"]}
            from app.validators import MealPlanDoc
            ctx.plan_doc = MealPlanDoc.model_validate(args["plan_json"])
            ctx.submitted = True
            return {"ok": True}
        return {"error": "?"}

    with patch.object(runner_mod, "dispatch", _fake_dispatch):
        fake_client = MagicMock()
        fake_client.messages.create.side_effect = responses
        with patch.object(runner_mod, "Anthropic", return_value=fake_client):
            events = _collect_sync(_make_req())

    phases = [d.get("phase") for n, d in events if n == "phase"]
    assert "repair" in phases
    assert events[-1][0] == "complete"


def test_run_agent_no_plan_submitted_yields_error(monkeypatch):
    monkeypatch.setattr(runner_mod.config, "MINIMAX_API_KEY", "fake-key")
    monkeypatch.setattr(runner_mod.config, "AGENT_MAX_TURNS", 2)

    # The model just chats and gives up
    responses = [
        _FakeResponse(content=[_text("hmm")], stop_reason="end_turn"),
    ]

    fake_client = MagicMock()
    fake_client.messages.create.side_effect = responses
    with patch.object(runner_mod, "Anthropic", return_value=fake_client):
        events = _collect_sync(_make_req())

    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "no_plan_submitted"
