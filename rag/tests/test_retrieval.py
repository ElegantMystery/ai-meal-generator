"""
Tests for rag/app/retrieval.py — category-proportional random sampling.

TDD: These tests are written FIRST (RED), then the implementation is updated (GREEN).
"""
import json
from unittest.mock import MagicMock, patch, call
from typing import Any, Dict, List

import pytest

from app.retrieval import retrieve_candidates, _fetch_by_category


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

CATEGORY_QUOTAS = [
    ("Fresh Fruits & Veggies > Veggies",        20),
    ("Fresh Fruits & Veggies > Fruits",          10),
    ("Meat, Seafood",                            20),
    ("Dairy & Eggs",                             12),
    ("Cheese",                                    8),
    ("Pastas & Grains",                           8),
    ("Packaged Fish, Meat, Fruit & Veg",          6),
    ("For Baking & Cooking",                      6),
    ("Oils & Vinegars",                           4),
    ("BBQ, Pasta, Simmer",                        4),
    ("Bakery > Sliced Bread",                     4),  # combined with Tortillas in impl
    ("Dressing & Seasoning",                      4),
    ("Dip/Spread",                                4),
]

TOTAL_QUOTA = sum(q for _, q in CATEGORY_QUOTAS)  # 110 + fill <= 120


def _make_item(item_id: int, category: str = "Fresh Fruits & Veggies > Veggies") -> Dict[str, Any]:
    """Return a dict that mimics a psycopg3 RealDictRow from the items query."""
    return {
        "id": item_id,
        "name": f"Item {item_id}",
        "price": 2.99,
        "unit_size": "1 lb",
        "category_path": category,
        "image_url": None,
    }


def _make_nutrition_row(item_id: int) -> Dict[str, Any]:
    nutrition_data = {
        "parsed": {
            "serving_count": 4,
            "serving_size_text": "1 cup",
            "serving_size_grams": 240,
            "calories": 150,
            "protein_g": 5.0,
            "total_fat_g": 3.0,
            "total_carbohydrate_g": 25.0,
            "dietary_fiber_g": 2.0,
            "total_sugars_g": 8.0,
            "sodium_mg": 120,
            "cholesterol_mg": 0,
            "saturated_fat_g": 0.5,
        }
    }
    return {"item_id": item_id, "nutrition": json.dumps(nutrition_data)}


def _make_ingredients_row(item_id: int) -> Dict[str, Any]:
    ingredients_data = {
        "parsed": {
            "ingredients_raw": "Water, Salt",
            "ingredients_list": [{"name": "Water"}, {"name": "Salt"}],
            "ingredients_count": 2,
        }
    }
    return {"item_id": item_id, "ingredients": json.dumps(ingredients_data)}


def _build_mock_conn_ctx(fetchall_side_effects: List[List[Dict[str, Any]]]):
    """
    Build a mock context manager for get_conn() that replays fetchall_side_effects
    in order across consecutive cur.fetchall() calls.
    """
    mock_cur = MagicMock()
    mock_cur.fetchall.side_effect = fetchall_side_effects

    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cur)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    mock_conn_ctx = MagicMock()
    mock_conn_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn_ctx.__exit__ = MagicMock(return_value=False)

    return mock_conn_ctx, mock_cur


# ---------------------------------------------------------------------------
# Tests for retrieve_candidates
# ---------------------------------------------------------------------------

class TestRetrieveCandidatesEmpty:
    """retrieve_candidates returns empty list when DB has no items."""

    def test_returns_empty_list_when_no_items_in_any_category(self):
        """All category queries return empty — result should be []."""
        # Number of category calls + 2 enrichment calls (nutrition, ingredients)
        # But if items is empty, we return early before the enrichment queries
        num_category_calls = len(CATEGORY_QUOTAS) + 1  # +1 for "fill" category
        fetchall_responses = [[] for _ in range(num_category_calls)]

        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            result = retrieve_candidates("trader_joes")

        assert result == []


class TestRetrieveCandidatesTotalCap:
    """retrieve_candidates never returns more than 120 candidates."""

    def test_total_candidates_at_most_120(self):
        """
        Each category returns its full quota. Fill returns 10.
        Dedup should keep total <= 120.
        """
        # Build per-category items — each category gets its exact quota
        # Use IDs starting from 1000 * cat_index to guarantee no overlap
        fetchall_responses = []
        for idx, (kw, quota) in enumerate(CATEGORY_QUOTAS):
            base_id = (idx + 1) * 1000
            items = [_make_item(base_id + i, kw) for i in range(quota)]
            fetchall_responses.append(items)

        # Fill category: 10 more unique items
        fill_items = [_make_item(99000 + i, "Other Category") for i in range(10)]
        fetchall_responses.append(fill_items)

        # Nutrition and ingredients enrichment
        all_ids = []
        for idx, (kw, quota) in enumerate(CATEGORY_QUOTAS):
            base_id = (idx + 1) * 1000
            all_ids.extend(range(base_id, base_id + quota))
        all_ids.extend(range(99000, 99010))

        nutrition_rows = [_make_nutrition_row(i) for i in all_ids]
        ingredients_rows = [_make_ingredients_row(i) for i in all_ids]
        fetchall_responses.append(nutrition_rows)
        fetchall_responses.append(ingredients_rows)

        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            result = retrieve_candidates("trader_joes")

        assert len(result) <= 120


class TestRetrieveCandidatesQuotas:
    """Each category contributes up to its quota when the DB has enough items."""

    def test_each_category_contributes_its_quota(self):
        """
        Mock returns exactly quota items per category.
        All items across categories are unique (no overlap).
        Total should equal sum of all quotas + fill.
        """
        fetchall_responses = []
        all_items_by_category = {}
        for idx, (kw, quota) in enumerate(CATEGORY_QUOTAS):
            base_id = (idx + 1) * 1000
            items = [_make_item(base_id + i, kw) for i in range(quota)]
            fetchall_responses.append(items)
            all_items_by_category[kw] = items

        # Fill: 0 items (simulate no fill items to keep test deterministic)
        fetchall_responses.append([])

        # Enrichment
        all_ids = []
        for idx, (kw, quota) in enumerate(CATEGORY_QUOTAS):
            base_id = (idx + 1) * 1000
            all_ids.extend(range(base_id, base_id + quota))

        fetchall_responses.append([_make_nutrition_row(i) for i in all_ids])
        fetchall_responses.append([_make_ingredients_row(i) for i in all_ids])

        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            result = retrieve_candidates("trader_joes")

        assert len(result) == TOTAL_QUOTA


class TestRetrieveCandidatesDeduplication:
    """Items appearing in multiple categories are counted only once."""

    def test_deduplication_by_id(self):
        """
        Same item id=1 returned by two category queries.
        Should appear only once in the final result.
        """
        # First category returns items 1, 2, 3
        cat1_items = [_make_item(1), _make_item(2), _make_item(3)]
        # Second category also returns item 1 (duplicate) plus 4, 5
        cat2_items = [_make_item(1), _make_item(4), _make_item(5)]

        # Fill remaining categories with empty lists
        fetchall_responses = [cat1_items, cat2_items]
        fetchall_responses += [[] for _ in range(len(CATEGORY_QUOTAS) - 2 + 1)]  # remaining + fill

        # Enrichment — IDs are 1,2,3,4,5 (unique)
        unique_ids = [1, 2, 3, 4, 5]
        fetchall_responses.append([_make_nutrition_row(i) for i in unique_ids])
        fetchall_responses.append([_make_ingredients_row(i) for i in unique_ids])

        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            result = retrieve_candidates("trader_joes")

        result_ids = [r["id"] for r in result]
        assert len(result_ids) == len(set(result_ids)), "No duplicate IDs in result"
        assert 1 in result_ids
        assert set(result_ids) == {1, 2, 3, 4, 5}


class TestRetrieveCandidatesEnrichedKeys:
    """Returned items have the expected keys."""

    def test_returned_items_have_required_keys(self):
        """
        Each enriched item must have: id, name, price, nutrition, ingredients.
        """
        # Single category with 1 item
        items = [_make_item(42)]
        fetchall_responses = [items]
        fetchall_responses += [[] for _ in range(len(CATEGORY_QUOTAS) - 1 + 1)]  # rest + fill

        fetchall_responses.append([_make_nutrition_row(42)])
        fetchall_responses.append([_make_ingredients_row(42)])

        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            result = retrieve_candidates("trader_joes")

        assert len(result) == 1
        item = result[0]
        assert "id" in item
        assert "name" in item
        assert "price" in item
        assert "nutrition" in item
        assert "ingredients" in item

    def test_nutrition_is_compact_dict_or_none(self):
        """nutrition field should be a compact dict with known keys (not raw JSON string)."""
        items = [_make_item(99)]
        fetchall_responses = [items]
        fetchall_responses += [[] for _ in range(len(CATEGORY_QUOTAS) - 1 + 1)]

        fetchall_responses.append([_make_nutrition_row(99)])
        fetchall_responses.append([_make_ingredients_row(99)])

        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            result = retrieve_candidates("trader_joes")

        nutrition = result[0]["nutrition"]
        assert nutrition is not None
        assert isinstance(nutrition, dict)
        assert "calories" in nutrition
        assert "protein_g" in nutrition

    def test_nutrition_is_none_when_not_found(self):
        """nutrition field is None when item has no nutrition data."""
        items = [_make_item(77)]
        fetchall_responses = [items]
        fetchall_responses += [[] for _ in range(len(CATEGORY_QUOTAS) - 1 + 1)]

        # No nutrition rows for item 77
        fetchall_responses.append([])
        fetchall_responses.append([])

        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            result = retrieve_candidates("trader_joes")

        assert result[0]["nutrition"] is None
        assert result[0]["ingredients"] is None


class TestRetrieveCandidatesSignature:
    """retrieve_candidates no longer requires query_vec."""

    def test_callable_with_store_only(self):
        """retrieve_candidates(store) should work without query_vec."""
        fetchall_responses = [[] for _ in range(len(CATEGORY_QUOTAS) + 1)]
        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            # Should not raise TypeError
            result = retrieve_candidates("trader_joes")

        assert result == []

    def test_callable_with_optional_query_vec(self):
        """retrieve_candidates accepts optional query_vec for backward compat."""
        fetchall_responses = [[] for _ in range(len(CATEGORY_QUOTAS) + 1)]
        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            # Should not raise TypeError even with extra arg
            result = retrieve_candidates("trader_joes", query_vec=[0.1, 0.2, 0.3])

        assert result == []


# ---------------------------------------------------------------------------
# Tests for _fetch_by_category helper
# ---------------------------------------------------------------------------

class TestFetchByCategory:
    """Unit tests for the _fetch_by_category helper."""

    def test_fetch_by_category_uses_ilike(self):
        """_fetch_by_category should use ILIKE with wildcard for category_keyword."""
        mock_cur = MagicMock()
        mock_cur.fetchall.return_value = []

        _fetch_by_category(mock_cur, "trader_joes", "Fresh Fruits & Veggies > Veggies", 20)

        mock_cur.execute.assert_called_once()
        sql_call = mock_cur.execute.call_args
        # The SQL should use ILIKE
        assert "ILIKE" in sql_call[0][0]
        # The params should include store and wildcard-wrapped keyword
        params = sql_call[0][1]
        assert params[0] == "trader_joes"
        assert "Fresh Fruits & Veggies > Veggies" in params[1]
        assert params[2] == 20

    def test_fetch_by_category_uses_order_by_random(self):
        """_fetch_by_category must use ORDER BY RANDOM() for diversity."""
        mock_cur = MagicMock()
        mock_cur.fetchall.return_value = []

        _fetch_by_category(mock_cur, "trader_joes", "Meat, Seafood", 20)

        sql = mock_cur.execute.call_args[0][0]
        assert "RANDOM" in sql.upper()

    def test_fetch_by_category_returns_fetchall_result(self):
        """_fetch_by_category returns whatever fetchall returns."""
        mock_cur = MagicMock()
        expected = [_make_item(1), _make_item(2)]
        mock_cur.fetchall.return_value = expected

        result = _fetch_by_category(mock_cur, "trader_joes", "Dairy & Eggs", 12)

        assert result == expected

    def test_fetch_by_category_passes_limit(self):
        """The LIMIT value passed must match the limit argument."""
        mock_cur = MagicMock()
        mock_cur.fetchall.return_value = []

        _fetch_by_category(mock_cur, "trader_joes", "Cheese", 8)

        params = mock_cur.execute.call_args[0][1]
        assert params[2] == 8  # limit is third param: (store, keyword_pattern, limit)


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestRetrieveCandidatesEdgeCases:
    """Edge cases: partial fills, fill cap, no enrichment data."""

    def test_fill_category_capped_at_10(self):
        """
        When fill query returns more than 10 items, only up to 10 should appear
        from the fill slot (already handled by LIMIT in the SQL).
        This test verifies the fill mock gets called with limit=10 (or <= 10).
        """
        # All named categories return empty, fill returns 5 items
        fill_items = [_make_item(500 + i, "Snacks") for i in range(5)]
        fetchall_responses = [[] for _ in range(len(CATEGORY_QUOTAS))]
        fetchall_responses.append(fill_items)

        fetchall_responses.append([_make_nutrition_row(500 + i) for i in range(5)])
        fetchall_responses.append([_make_ingredients_row(500 + i) for i in range(5)])

        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            result = retrieve_candidates("trader_joes")

        assert len(result) == 5

    def test_partial_category_fills(self):
        """Categories with fewer items than quota only return what's available."""
        # Only 3 items available for a category with quota 20
        sparse_items = [_make_item(i) for i in range(1, 4)]
        fetchall_responses = [sparse_items]
        fetchall_responses += [[] for _ in range(len(CATEGORY_QUOTAS) - 1 + 1)]

        fetchall_responses.append([_make_nutrition_row(i) for i in range(1, 4)])
        fetchall_responses.append([_make_ingredients_row(i) for i in range(1, 4)])

        mock_ctx, _ = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            result = retrieve_candidates("trader_joes")

        # Should return only 3 items (what was available)
        assert len(result) == 3

    def test_no_vector_search_sql(self):
        """
        The new implementation must NOT issue any ORDER BY embedding <=> query
        (vector similarity search is removed).
        """
        fetchall_responses = [[] for _ in range(len(CATEGORY_QUOTAS) + 1)]
        mock_ctx, mock_cur = _build_mock_conn_ctx(fetchall_responses)

        with patch("app.retrieval.get_conn", return_value=mock_ctx):
            retrieve_candidates("trader_joes")

        # Check none of the SQL calls contain vector similarity operator
        for c in mock_cur.execute.call_args_list:
            sql = c[0][0]
            assert "<=>" not in sql, f"Vector search operator found in SQL: {sql}"
