"""Unit tests for costco/parse_nutrition.py"""
import json
import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from parse_nutrition import parse_nutrition_text, parse_nutrition_structured, parse_json_file


class TestParseNutritionText:
    def test_basic_facts_block(self):
        text = (
            "Nutrition Facts Serving Size 1 cup (240g) "
            "Calories per serving 150 "
            "Total Fat 5g Saturated Fat 2g Trans Fat 0g "
            "Cholesterol 10mg Sodium 200mg "
            "Total Carbohydrate 20g Dietary Fiber 3g Total Sugars 8g Added Sugars 2g "
            "Protein 6g Vitamin D 2mcg Calcium 300mg Iron 1mg Potassium 400mg"
        )
        result = parse_nutrition_text(text)
        assert result is not None
        assert result["calories"] == 150
        assert result["total_fat_g"] == 5.0
        assert result["saturated_fat_g"] == 2.0
        assert result["trans_fat_g"] == 0.0
        assert result["cholesterol_mg"] == 10.0
        assert result["sodium_mg"] == 200.0
        assert result["total_carbohydrate_g"] == 20.0
        assert result["dietary_fiber_g"] == 3.0
        assert result["total_sugars_g"] == 8.0
        assert result["added_sugars_g"] == 2.0
        assert result["protein_g"] == 6.0
        assert result["vitamin_d_mcg"] == 2.0
        assert result["calcium_mg"] == 300.0
        assert result["iron_mg"] == 1.0
        assert result["potassium_mg"] == 400.0

    def test_serving_size_grams_extracted(self):
        text = "Nutrition Facts serving size 1 cup (240g) Calories per serving 100"
        result = parse_nutrition_text(text)
        assert result is not None
        assert result.get("serving_size_grams") == 240.0

    def test_returns_none_without_calories(self):
        text = "Total Fat 5g Sodium 200mg Protein 3g"
        result = parse_nutrition_text(text)
        assert result is None

    def test_handles_empty_string(self):
        assert parse_nutrition_text("") is None

    def test_handles_none(self):
        assert parse_nutrition_text(None) is None

    def test_less_than_values(self):
        text = "Nutrition Facts Calories per serving 30 Trans Fat less than 1g Sodium less than 5mg"
        result = parse_nutrition_text(text)
        assert result is not None
        assert result["trans_fat_g"] == 1.0
        assert result["sodium_mg"] == 5.0

    def test_costco_calories_colon_format(self):
        """Costco PDPs sometimes render 'Calories: 130' instead of 'Calories per serving 130'."""
        text = "Nutrition Facts Serving Size 1 bar Calories: 130 Total Fat 5g Protein 3g"
        result = parse_nutrition_text(text)
        assert result is not None
        assert result["calories"] == 130

    def test_strips_note_disclaimer(self):
        text = (
            "Calories per serving 200 Total Fat 8g "
            "NOTE: Since posting, the ingredients in our products may have changed."
        )
        result = parse_nutrition_text(text)
        assert result is not None
        assert result["calories"] == 200


class TestParseNutritionStructured:
    def test_camelcase_fields(self):
        data = {
            "calories": 200,
            "totalFat": "8g",
            "saturatedFat": "3g",
            "sodium": "450mg",
            "totalCarbohydrate": "30g",
            "protein": "7g",
            "servingSize": "1 cup (240g)",
            "servingsPerContainer": "2",
        }
        result = parse_nutrition_structured(data)
        assert result is not None
        assert result["calories"] == 200.0
        assert result["total_fat_g"] == 8.0
        assert result["saturated_fat_g"] == 3.0
        assert result["sodium_mg"] == 450.0
        assert result["total_carbohydrate_g"] == 30.0
        assert result["protein_g"] == 7.0
        assert result["serving_size_text"] == "1 cup (240g)"
        assert result["serving_size_grams"] == 240.0
        assert result["serving_count"] == 2

    def test_snake_case_fields(self):
        data = {
            "calories": 100,
            "total_fat": "4g",
            "dietary_fiber": "2g",
        }
        result = parse_nutrition_structured(data)
        assert result is not None
        assert result["total_fat_g"] == 4.0
        assert result["dietary_fiber_g"] == 2.0

    def test_returns_none_without_calories(self):
        data = {"totalFat": "5g", "sodium": "200mg"}
        assert parse_nutrition_structured(data) is None

    def test_returns_none_for_non_dict(self):
        assert parse_nutrition_structured("not a dict") is None
        assert parse_nutrition_structured(None) is None
        assert parse_nutrition_structured([]) is None


class TestParseJsonFile:
    def _make_item(self, sku, name, nutrition):
        return {"store": "COSTCO", "sku": sku, "name": name, "nutrition": nutrition}

    def test_parses_text_nutrition(self, tmp_path):
        items = [
            self._make_item(
                "111111",
                "Kirkland PB",
                "Calories per serving 190 Total Fat 16g Protein 7g",
            )
        ]
        input_file = tmp_path / "items.json"
        output_file = tmp_path / "out.json"
        input_file.write_text(json.dumps(items))

        result = parse_json_file(str(input_file), str(output_file))
        assert result["summary"]["successfully_parsed"] == 1
        assert result["summary"]["items_without_nutrition"] == 0

        saved = json.loads(output_file.read_text())
        assert saved["parsed_items"][0]["sku"] == "111111"
        assert saved["parsed_items"][0]["nutrition_parsed"]["calories"] == 190

    def test_parses_structured_nutrition(self, tmp_path):
        items = [
            self._make_item(
                "222222",
                "Costco Crackers",
                {"calories": 130, "totalFat": "5g", "sodium": "180mg"},
            )
        ]
        input_file = tmp_path / "items.json"
        output_file = tmp_path / "out.json"
        input_file.write_text(json.dumps(items))

        result = parse_json_file(str(input_file), str(output_file))
        assert result["summary"]["successfully_parsed"] == 1
        parsed = result["parsed_items"][0]["nutrition_parsed"]
        assert parsed["calories"] == 130.0
        assert parsed["total_fat_g"] == 5.0

    def test_items_without_nutrition_counted(self, tmp_path):
        items = [
            self._make_item("333333", "Plain Water", None),
            self._make_item("444444", "Chips", "Calories per serving 150 Total Fat 8g"),
        ]
        input_file = tmp_path / "items.json"
        input_file.write_text(json.dumps(items))

        result = parse_json_file(str(input_file))
        assert result["summary"]["items_without_nutrition"] == 1
        assert result["summary"]["successfully_parsed"] == 1

    def test_raises_on_non_list_input(self, tmp_path):
        input_file = tmp_path / "bad.json"
        input_file.write_text(json.dumps({"key": "value"}))
        with pytest.raises(ValueError, match="JSON array"):
            parse_json_file(str(input_file))
