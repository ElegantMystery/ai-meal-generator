"""
Tests for rag/app/agent/tools.py.

Tools are tested in isolation by mocking the get_conn() context manager —
no live DB or live Anthropic call.
"""
from __future__ import annotations

from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest
from psycopg import OperationalError

from app.agent.tools import ToolContext, dispatch
from app.retrieval import _CATEGORY_QUOTAS_TJ, _CATEGORY_QUOTAS_WF


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class _CursorStub:
    """Tiny context-managed cursor stub that returns canned rows by call order."""

    def __init__(self, fetch_results: List[List[Dict[str, Any]] | Dict[str, Any]]):
        self._fetch_results = list(fetch_results)
        self.executed: List[tuple] = []
        self._next_one: Dict[str, Any] | None = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.executed.append((sql, params))
        # If next result is a single dict, queue it for fetchone
        if self._fetch_results and isinstance(self._fetch_results[0], dict):
            self._next_one = self._fetch_results.pop(0)

    def fetchall(self):
        if not self._fetch_results:
            return []
        return self._fetch_results.pop(0)

    def fetchone(self):
        if self._next_one is not None:
            row = self._next_one
            self._next_one = None
            return row
        if self._fetch_results and isinstance(self._fetch_results[0], dict):
            return self._fetch_results.pop(0)
        return None


class _ConnStub:
    def __init__(self, cursor: _CursorStub):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return self._cursor


class _MultiPatch:
    """Apply the same get_conn fake at multiple import sites."""

    def __init__(self, cur: _CursorStub, targets: List[str]):
        self._patchers = [patch(t, return_value=_ConnStub(cur)) for t in targets]

    def __enter__(self):
        for p in self._patchers:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in reversed(self._patchers):
            p.stop()
        return False


def _patch_conn(cur: _CursorStub):
    """Patch every get_conn lookup used by tools and validators."""
    return _MultiPatch(cur, ["app.agent.tools.get_conn", "app.verify.get_conn"])


def _ctx(store: str = "TRADER_JOES") -> ToolContext:
    return ToolContext(store=store, days=3, start_date="2026-05-12", dietary_restriction=None)


# ---------------------------------------------------------------------------
# list_categories
# ---------------------------------------------------------------------------


def test_list_categories_returns_quotas_for_tj():
    # Single fetchall returns rows with kw+n — matches the consolidated SQL query
    tj_rows = [{"kw": kw, "n": 50} for kw, _ in _CATEGORY_QUOTAS_TJ]
    cur = _CursorStub([tj_rows])
    with _patch_conn(cur):
        result = dispatch("list_categories", {}, _ctx("TRADER_JOES"))
    assert result["store"] == "TRADER_JOES"
    assert len(result["categories"]) == 13
    assert all("category" in c and "approx_item_count" in c for c in result["categories"])


def test_list_categories_uses_wf_quotas_for_whole_foods():
    wf_rows = [{"kw": kw, "n": 100} for kw, _ in _CATEGORY_QUOTAS_WF]
    cur = _CursorStub([wf_rows])
    with _patch_conn(cur):
        result = dispatch("list_categories", {}, _ctx("WHOLE_FOODS"))
    assert result["store"] == "WHOLE_FOODS"
    assert len(result["categories"]) == 9


# ---------------------------------------------------------------------------
# search_items
# ---------------------------------------------------------------------------


def test_search_items_returns_compact_rows():
    rows = [
        {"id": 1, "name": "Broccoli", "price": "2.99", "unit_size": "12 oz",
         "category_path": "Produce > Veggies", "image_url": "x.jpg"},
        {"id": 2, "name": "Spinach", "price": "3.49", "unit_size": "8 oz",
         "category_path": "Produce > Greens", "image_url": "y.jpg"},
    ]
    cur = _CursorStub([rows])
    with _patch_conn(cur):
        result = dispatch("search_items", {"category": "produce", "limit": 5}, _ctx())
    assert result["count"] == 2
    assert result["items"][0]["id"] == 1
    # image_url is intentionally not surfaced (saves tokens for the agent)
    assert "image_url" not in result["items"][0]


def test_search_items_rejects_missing_category():
    result = dispatch("search_items", {}, _ctx())
    assert "error" in result


def test_search_items_clamps_limit_to_30():
    cur = _CursorStub([[]])
    with _patch_conn(cur):
        dispatch("search_items", {"category": "x", "limit": 999}, _ctx())
    # The _fetch_by_category helper got called with limit=30
    _, params = cur.executed[-1]
    assert params[-1] == 30


# ---------------------------------------------------------------------------
# get_item_details
# ---------------------------------------------------------------------------


def test_get_item_details_returns_full_record():
    cur = _CursorStub([
        {
            "id": 42, "name": "Chicken Thighs", "price": "8.99", "unit_size": "1 lb",
            "category_path": "Meat > Poultry",
            "nutrition": {"parsed": {"calories": 220, "protein_g": 30, "serving_count": 4}},
            "ingredients": {"parsed": {"ingredients_raw": "chicken"}},
        }
    ])
    with _patch_conn(cur):
        result = dispatch("get_item_details", {"item_id": 42}, _ctx())
    assert result["id"] == 42
    assert result["nutrition"]["protein_g"] == 30


def test_get_item_details_missing_returns_error():
    cur = _CursorStub([])  # fetchone returns None
    with _patch_conn(cur):
        result = dispatch("get_item_details", {"item_id": 9999}, _ctx())
    assert "error" in result


def test_get_item_details_bad_id_type():
    result = dispatch("get_item_details", {"item_id": "not a number"}, _ctx())
    assert "error" in result


# ---------------------------------------------------------------------------
# validate_item_ids
# ---------------------------------------------------------------------------


def test_validate_item_ids_splits_valid_and_missing():
    cur = _CursorStub([[{"id": 1}, {"id": 3}]])
    with _patch_conn(cur):
        result = dispatch("validate_item_ids", {"item_ids": [1, 2, 3, 4]}, _ctx())
    assert result["valid"] == [1, 3]
    assert result["missing"] == [2, 4]


def test_validate_item_ids_empty_returns_error():
    result = dispatch("validate_item_ids", {"item_ids": []}, _ctx())
    assert "error" in result


# ---------------------------------------------------------------------------
# submit_plan -- repair loop
# ---------------------------------------------------------------------------


def _minimal_plan(item_id: int) -> Dict[str, Any]:
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
                                    {"id": item_id, "name": "Lettuce", "servingsUsed": 1.0,
                                     "amountUsed": {"value": 85, "unit": "g"}},
                                    {"id": item_id + 1, "name": "Tomato", "servingsUsed": 0.5,
                                     "amountUsed": {"value": 80, "unit": "g"}},
                                    {"id": item_id + 2, "name": "Olive Oil", "servingsUsed": 0.2,
                                     "amountUsed": {"value": 10, "unit": "ml"}},
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
    }


def test_submit_plan_happy_path_captures_doc():
    ctx = _ctx()
    cur = _CursorStub([[{"id": 1}, {"id": 2}, {"id": 3}]])
    with _patch_conn(cur):
        result = dispatch("submit_plan", {"plan_json": _minimal_plan(1)}, ctx)
    assert result["ok"] is True
    assert ctx.submitted is True
    assert ctx.plan_doc is not None
    assert ctx.plan_doc.title == "Test Plan"


def test_submit_plan_invalid_schema_returns_errors():
    ctx = _ctx()
    bad = {"title": "Missing fields"}
    result = dispatch("submit_plan", {"plan_json": bad}, ctx)
    assert result["ok"] is False
    assert "errors" in result
    assert ctx.submitted is False
    assert ctx.repair_attempted is True


def test_submit_plan_with_missing_ids_returns_errors():
    ctx = _ctx()
    # verify SQL says only id=1 exists -> 2 and 3 are missing
    cur = _CursorStub([[{"id": 1}]])
    with _patch_conn(cur):
        result = dispatch("submit_plan", {"plan_json": _minimal_plan(1)}, ctx)
    assert result["ok"] is False
    assert ctx.submitted is False
    assert ctx.repair_attempted is True


def test_submit_plan_rejects_mixed_units_for_same_product():
    ctx = _ctx()
    plan = _minimal_plan(1)
    second_dish = {
        "dishName": "Side",
        "items": [
            {
                "id": 1,
                "name": "Lettuce",
                "servingsUsed": 0.5,
                "amountUsed": {"value": 1, "unit": "count"},
            }
        ],
    }
    plan["plan"][0]["meals"][0]["dishes"].append(second_dish)

    result = dispatch("submit_plan", {"plan_json": plan}, ctx)

    assert result["ok"] is False
    assert "mixed amount units" in result["errors"][0]
    assert ctx.repair_attempted is True


def test_submit_plan_accepts_aggregate_above_per_dish_quantity_bounds():
    ctx = _ctx()
    plan = _minimal_plan(1)
    meal = plan["plan"][0]["meals"][0]
    meal["dishes"] = [
        {
            "dishName": f"Bulk dish {number}",
            "items": [{
                "id": 1,
                "name": "Bulk Ingredient",
                "servingsUsed": 15,
                "amountUsed": {"value": 6000, "unit": "g"},
            }],
        }
        for number in (1, 2)
    ]
    cur = _CursorStub([[{"id": 1}]])

    with _patch_conn(cur):
        result = dispatch("submit_plan", {"plan_json": plan}, ctx)

    assert result["ok"] is True
    item = ctx.plan_doc.plan[0].meals[0].items[0]
    assert item.servingsUsed == 30
    assert item.amountUsed.value == 12000


def test_submit_plan_returns_ingredient_error_then_accepts_repaired_copy():
    ctx = _ctx()
    plan = _minimal_plan(1)
    dish = plan["plan"][0]["meals"][0]["dishes"][0]
    dish["dishName"] = "Avocado Salad"
    dish["description"] = "Fresh avocado with vegetables"

    selected_rows = [
        {"id": 1, "name": "Lettuce", "ingredients": None},
        {"id": 2, "name": "Tomato", "ingredients": None},
        {"id": 3, "name": "Olive Oil", "ingredients": None},
    ]
    recipe_rows = [{"ingredients_json": '[{"name":"avocado"}]'}]
    verification_rows = [{"id": 1}, {"id": 2}, {"id": 3}]
    cur = _CursorStub([
        verification_rows, selected_rows, recipe_rows,
        verification_rows, selected_rows, recipe_rows,
    ])

    with _patch_conn(cur):
        rejected = dispatch("submit_plan", {"plan_json": plan}, ctx)
        dish["dishName"] = "Garden Salad"
        dish["description"] = "Crisp vegetables"
        accepted = dispatch("submit_plan", {"plan_json": plan}, ctx)

    assert rejected["ok"] is False
    assert "Day 1 Lunch dish 1" in rejected["errors"][0]
    assert "avocado" in rejected["errors"][0]
    assert accepted["ok"] is True
    assert ctx.submitted is True


def test_submit_plan_propagates_database_failure():
    ctx = _ctx()
    failure = OperationalError("database connection failed")

    with patch(
        "app.agent.tools.verify_item_ids_belong_to_store",
        side_effect=failure,
    ):
        with pytest.raises(OperationalError) as exc_info:
            dispatch("submit_plan", {"plan_json": _minimal_plan(1)}, ctx)

    assert exc_info.value is failure
    assert ctx.submitted is False
    assert ctx.repair_attempted is False


def test_submit_plan_propagates_ingredient_metadata_database_failure():
    ctx = _ctx()
    failure = OperationalError("ingredient query failed")

    with patch("app.agent.tools.verify_item_ids_belong_to_store"):
        with patch(
            "app.agent.tools._load_ingredient_validation_data",
            side_effect=failure,
        ):
            with pytest.raises(OperationalError) as exc_info:
                dispatch("submit_plan", {"plan_json": _minimal_plan(1)}, ctx)

    assert exc_info.value is failure
    assert ctx.submitted is False
    assert ctx.repair_attempted is False


def test_submit_plan_propagates_unexpected_validator_failure():
    ctx = _ctx()
    failure = RuntimeError("unexpected validator failure")

    with patch(
        "app.agent.tools.parse_and_validate_plan_json",
        side_effect=failure,
    ):
        with pytest.raises(RuntimeError) as exc_info:
            dispatch("submit_plan", {"plan_json": _minimal_plan(1)}, ctx)

    assert exc_info.value is failure
    assert ctx.submitted is False
    assert ctx.repair_attempted is False


# ---------------------------------------------------------------------------
# dispatch unknown tool
# ---------------------------------------------------------------------------


def test_dispatch_unknown_tool_returns_error():
    result = dispatch("not_a_tool", {}, _ctx())
    assert "error" in result
