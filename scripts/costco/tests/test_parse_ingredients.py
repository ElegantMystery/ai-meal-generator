"""Unit tests for costco/parse_ingredients.py"""
import json
import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from parse_ingredients import parse_ingredients_text, split_ingredients, parse_json_file


class TestSplitIngredients:
    def test_simple_comma_list(self):
        result = split_ingredients("SALT, SUGAR, FLOUR")
        assert [i["name"] for i in result] == ["SALT", "SUGAR", "FLOUR"]

    def test_does_not_split_inside_parens(self):
        result = split_ingredients("RICE (WATER, RICE), SALT")
        names = [i["name"] for i in result]
        assert "RICE (WATER, RICE)" in names or "RICE" in names
        assert "SALT" in names

    def test_strips_trailing_period(self):
        result = split_ingredients("SALT.")
        assert result[0]["name"] == "SALT"

    def test_empty_string(self):
        assert split_ingredients("") == []

    def test_strips_leading_and_or(self):
        result = split_ingredients("AND SALT, OR SUGAR")
        names = [i["name"] for i in result]
        assert "SALT" in names
        assert "SUGAR" in names


class TestParseIngredientsText:
    def test_basic_list(self):
        text = "WHOLE WHEAT FLOUR, SUGAR, PALM OIL, SALT."
        result = parse_ingredients_text(text)
        assert result is not None
        names = [i["name"] for i in result["ingredients_list"]]
        assert "WHOLE WHEAT FLOUR" in names
        assert "SUGAR" in names
        assert "PALM OIL" in names
        assert "SALT" in names
        assert result["ingredients_count"] == 4

    def test_contains_less_than_clause(self):
        text = "PORK, SEA SALT, CONTAINS 2% OR LESS OF CULTURED SWISS CHARD POWDER, DEXTROSE."
        result = parse_ingredients_text(text)
        assert result is not None
        assert len(result["contains_less_than"]) == 1
        clause = result["contains_less_than"][0]
        assert clause["percentage"] == 2.0
        names = [i["name"] for i in clause["ingredients"]]
        assert "CULTURED SWISS CHARD POWDER" in names

    def test_deduplicates(self):
        text = "SALT, SUGAR, SALT"
        result = parse_ingredients_text(text)
        assert result is not None
        names = [i["name"] for i in result["ingredients_list"]]
        assert names.count("SALT") == 1

    def test_normalises_to_uppercase(self):
        text = "whole wheat flour, sugar"
        result = parse_ingredients_text(text)
        assert result is not None
        names = [i["name"] for i in result["ingredients_list"]]
        assert "WHOLE WHEAT FLOUR" in names
        assert "SUGAR" in names

    def test_empty_string_returns_none(self):
        assert parse_ingredients_text("") is None

    def test_none_returns_none(self):
        assert parse_ingredients_text(None) is None

    def test_ingredients_raw_preserved(self):
        text = "FLOUR, SALT."
        result = parse_ingredients_text(text)
        assert result is not None
        assert result["ingredients_raw"] == text.strip()

    def test_semicolon_section_split(self):
        text = "SALAMI: PORK, SALT; CHEESE: MILK, CULTURES"
        result = parse_ingredients_text(text)
        assert result is not None
        assert result["ingredients_count"] > 0


class TestParseJsonFile:
    def _make_item(self, sku, name, ingredients):
        return {"store": "COSTCO", "sku": sku, "name": name, "ingredients": ingredients}

    def test_parses_plain_text_ingredients(self, tmp_path):
        items = [self._make_item("111111", "Crackers", "FLOUR, SALT, PALM OIL.")]
        input_file = tmp_path / "items.json"
        output_file = tmp_path / "out.json"
        input_file.write_text(json.dumps(items))

        result = parse_json_file(str(input_file), str(output_file))
        assert result["summary"]["successfully_parsed"] == 1
        saved = json.loads(output_file.read_text())
        parsed = saved["parsed_items"][0]["ingredients_parsed"]
        assert parsed["ingredients_count"] == 3

    def test_parses_structured_list(self, tmp_path):
        items = [
            self._make_item(
                "222222",
                "Sausage",
                [{"ingredient": "PORK"}, {"ingredient": "SALT"}],
            )
        ]
        input_file = tmp_path / "items.json"
        output_file = tmp_path / "out.json"
        input_file.write_text(json.dumps(items))

        result = parse_json_file(str(input_file), str(output_file))
        assert result["summary"]["successfully_parsed"] == 1
        parsed = result["parsed_items"][0]["ingredients_parsed"]
        assert parsed["ingredients_count"] == 2

    def test_items_without_ingredients_counted(self, tmp_path):
        items = [
            self._make_item("111", "Water", None),
            self._make_item("222", "Crackers", "FLOUR, SALT."),
        ]
        input_file = tmp_path / "items.json"
        input_file.write_text(json.dumps(items))

        result = parse_json_file(str(input_file))
        assert result["summary"]["items_without_ingredients"] == 1
        assert result["summary"]["successfully_parsed"] == 1

    def test_raises_on_non_list_input(self, tmp_path):
        input_file = tmp_path / "bad.json"
        input_file.write_text(json.dumps({"key": "value"}))
        with pytest.raises(ValueError, match="JSON array"):
            parse_json_file(str(input_file))
