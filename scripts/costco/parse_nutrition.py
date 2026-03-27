#!/usr/bin/env python3
"""
Parse nutrition data from costco-items.json.

Costco nutrition comes as one of:
  - Plain-text "Nutrition Facts" block scraped from PDP HTML
  - Structured JSON from a product-detail API (if available)

The plain-text path reuses the same parser as the TJ pipeline;
the structured path maps Costco's field names to the shared schema.

Output schema matches tj-nutrition-parsed.json exactly so import_costco.py
can consume it without special-casing.

Usage:
    python parse_nutrition.py <input_items.json> <output_parsed.json>

Environment variables:
    COSTCO_JSON_PATH           -- input file (overridden by positional arg 1)
    COSTCO_NUTRITION_OUTPUT    -- output file (overridden by positional arg 2)
"""

import json
import os
import re
import sys
from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# Shared nutrition text parser (identical to TJ's logic)
# ---------------------------------------------------------------------------

def parse_nutrition_text(nutrition_text: str) -> Optional[Dict[str, Any]]:
    """Parse a plain-text Nutrition Facts block into structured data."""
    if not nutrition_text or not isinstance(nutrition_text, str):
        return None

    text = re.sub(r"NOTE:.*$", "", nutrition_text, flags=re.DOTALL | re.IGNORECASE)
    result: Dict[str, Any] = {}

    serves_match = re.search(r"Serves\s+(?:about\s+)?(\d+)", text, re.IGNORECASE)
    if serves_match:
        result["serving_count"] = int(serves_match.group(1))

    serving_match = re.search(r"serving\s+size\s*([^(]+)", text, re.IGNORECASE)
    if serving_match:
        result["serving_size_text"] = serving_match.group(1).strip()
        weight_match = re.search(r"\((\d+(?:\.\d+)?)\s*g", text, re.IGNORECASE)
        if weight_match:
            try:
                result["serving_size_grams"] = float(weight_match.group(1))
            except ValueError:
                pass

    cal_match = re.search(
        r"calories\s+per\s+serving\s*(\d+)|calories\s*[:\s]\s*(\d+)",
        text,
        re.IGNORECASE,
    )
    if cal_match:
        val = cal_match.group(1) or cal_match.group(2)
        if val:
            result["calories"] = int(val)

    def extract_nutrient(pattern: str) -> Optional[float]:
        m = re.search(pattern, text, re.IGNORECASE)
        if not m:
            return None
        try:
            v = m.group(1)
            if re.search(r"less\s*than", v, re.IGNORECASE):
                lt = re.search(r"(\d+(?:\.\d+)?)", v)
                return float(lt.group(1)) if lt else 0.0
            return float(v)
        except (ValueError, AttributeError):
            return None

    result["total_fat_g"] = extract_nutrient(
        r"Total\s+Fat\s*((?:less\s*than\s*)?[\d.]+)\s*g"
    )
    result["saturated_fat_g"] = extract_nutrient(
        r"Saturated\s+Fat\s*((?:less\s*than\s*)?[\d.]+)\s*g"
    )
    result["trans_fat_g"] = extract_nutrient(
        r"Trans\s+Fat\s*((?:less\s*than\s*)?[\d.]+)\s*g"
    )
    result["cholesterol_mg"] = extract_nutrient(
        r"Cholesterol\s*((?:less\s*than\s*)?[\d.]+)\s*mg"
    )
    result["sodium_mg"] = extract_nutrient(
        r"Sodium\s*((?:less\s*than\s*)?[\d.]+)\s*mg"
    )
    result["total_carbohydrate_g"] = extract_nutrient(
        r"Total\s+Carbohydrate\s*((?:less\s*than\s*)?[\d.]+)\s*g"
    )
    result["dietary_fiber_g"] = extract_nutrient(
        r"Dietary\s+Fiber\s*((?:less\s*than\s*)?[\d.]+)\s*g"
    )
    result["total_sugars_g"] = extract_nutrient(
        r"Total\s+Sugars\s*((?:less\s*than\s*)?[\d.]+)\s*g"
    )
    result["added_sugars_g"] = extract_nutrient(
        r"Added\s+Sugars\s*((?:less\s*than\s*)?[\d.]+)\s*g"
    )
    result["protein_g"] = extract_nutrient(
        r"Protein\s*((?:less\s*than\s*)?[\d.]+)\s*g"
    )
    result["vitamin_d_mcg"] = extract_nutrient(
        r"Vitamin\s+D\s*((?:less\s*than\s*)?[\d.]+)\s*mcg"
    )
    result["calcium_mg"] = extract_nutrient(
        r"Calcium\s*((?:less\s*than\s*)?[\d.]+)\s*mg"
    )
    result["iron_mg"] = extract_nutrient(
        r"Iron\s*((?:less\s*than\s*)?[\d.]+)\s*mg"
    )
    result["potassium_mg"] = extract_nutrient(
        r"Potassium\s*((?:less\s*than\s*)?[\d.]+)\s*mg"
    )

    return result if "calories" in result else None


# ---------------------------------------------------------------------------
# Costco structured nutrition parser
# Handles JSON objects from Costco's product-detail API where fields are
# already labelled (e.g. { "calories": 130, "totalFat": "9g", ... })
# ---------------------------------------------------------------------------

_COSTCO_FIELD_MAP = {
    # camelCase API fields → shared schema keys
    "calories": "calories",
    "totalFat": "total_fat_g",
    "saturatedFat": "saturated_fat_g",
    "transFat": "trans_fat_g",
    "cholesterol": "cholesterol_mg",
    "sodium": "sodium_mg",
    "totalCarbohydrate": "total_carbohydrate_g",
    "dietaryFiber": "dietary_fiber_g",
    "totalSugars": "total_sugars_g",
    "addedSugars": "added_sugars_g",
    "protein": "protein_g",
    "vitaminD": "vitamin_d_mcg",
    "calcium": "calcium_mg",
    "iron": "iron_mg",
    "potassium": "potassium_mg",
    # alternate snake_case spellings
    "total_fat": "total_fat_g",
    "saturated_fat": "saturated_fat_g",
    "trans_fat": "trans_fat_g",
    "total_carbohydrate": "total_carbohydrate_g",
    "dietary_fiber": "dietary_fiber_g",
    "total_sugars": "total_sugars_g",
    "added_sugars": "added_sugars_g",
    "vitamin_d": "vitamin_d_mcg",
}


def _parse_num(val: Any) -> Optional[float]:
    if val is None:
        return None
    s = str(val).strip()
    m = re.search(r"([\d.]+)", s)
    return float(m.group(1)) if m else None


def parse_nutrition_structured(data: Any) -> Optional[Dict[str, Any]]:
    """
    Parse a Costco structured nutrition dict (from product-detail API).
    Returns the same schema as parse_nutrition_text().
    """
    if not isinstance(data, dict):
        return None

    result: Dict[str, Any] = {}

    # Serving info
    for k in ("servingSize", "serving_size", "servingSizeText"):
        if data.get(k):
            result["serving_size_text"] = str(data[k])
            wt = re.search(r"(\d+(?:\.\d+)?)\s*g", str(data[k]))
            if wt:
                result["serving_size_grams"] = float(wt.group(1))
            break

    for k in ("servingsPerContainer", "servings_per_container", "servingCount"):
        if data.get(k) is not None:
            m = re.search(r"(\d+)", str(data[k]))
            if m:
                result["serving_count"] = int(m.group(1))
            break

    # Map known fields
    for api_key, schema_key in _COSTCO_FIELD_MAP.items():
        if api_key in data and data[api_key] is not None:
            n = _parse_num(data[api_key])
            if n is not None:
                result[schema_key] = n

    return result if "calories" in result else None


# ---------------------------------------------------------------------------
# Main parse-file function
# ---------------------------------------------------------------------------

def parse_json_file(input_path: str, output_path: Optional[str] = None) -> Dict[str, Any]:
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError("Expected a JSON array at the top level")

    parsed_items = []
    parse_errors = []
    items_without_nutrition = []

    for idx, item in enumerate(data):
        if not isinstance(item, dict):
            continue

        sku = item.get("sku", f"unknown_{idx}")
        name = item.get("name", "Unknown")
        nutrition_raw = item.get("nutrition")

        if not nutrition_raw:
            items_without_nutrition.append({"sku": sku, "name": name})
            continue

        # Attempt 1: structured dict from Costco's product-detail API
        if isinstance(nutrition_raw, dict):
            parsed = parse_nutrition_structured(nutrition_raw)
            if parsed:
                parsed_items.append(
                    {
                        "sku": sku,
                        "name": name,
                        "nutrition_parsed": parsed,
                        "nutrition_raw": nutrition_raw,
                    }
                )
            else:
                parse_errors.append(
                    {
                        "sku": sku,
                        "name": name,
                        "nutrition_text": str(nutrition_raw)[:200],
                    }
                )
            continue

        # Attempt 2: plain-text Nutrition Facts block (HTML-scraped)
        if isinstance(nutrition_raw, str):
            parsed = parse_nutrition_text(nutrition_raw)
            if parsed:
                parsed_items.append(
                    {
                        "sku": sku,
                        "name": name,
                        "nutrition_parsed": parsed,
                        "nutrition_raw": nutrition_raw,
                    }
                )
            else:
                parse_errors.append(
                    {
                        "sku": sku,
                        "name": name,
                        "nutrition_text": nutrition_raw[:200],
                    }
                )
            continue

        # Attempt 3: list (Costco API may return an array of panel objects)
        if isinstance(nutrition_raw, list) and nutrition_raw:
            for panel in nutrition_raw:
                if isinstance(panel, dict):
                    parsed = parse_nutrition_structured(panel)
                    if parsed:
                        parsed_items.append(
                            {
                                "sku": sku,
                                "name": name,
                                "nutrition_parsed": parsed,
                                "nutrition_raw": nutrition_raw,
                            }
                        )
                        break
            else:
                parse_errors.append(
                    {"sku": sku, "name": name, "nutrition_text": str(nutrition_raw)[:200]}
                )
            continue

        items_without_nutrition.append({"sku": sku, "name": name})

    result = {
        "summary": {
            "total_items": len(data),
            "items_with_nutrition": len(data) - len(items_without_nutrition),
            "successfully_parsed": len(parsed_items),
            "parse_errors": len(parse_errors),
            "items_without_nutrition": len(items_without_nutrition),
        },
        "parsed_items": parsed_items,
        "parse_errors": parse_errors,
        "items_without_nutrition": items_without_nutrition,
    }

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"✅ Parsed nutrition data saved to: {output_path}")
    else:
        s = result["summary"]
        print("=" * 60)
        print("COSTCO NUTRITION PARSING SUMMARY")
        print("=" * 60)
        print(f"Total items:              {s['total_items']}")
        print(f"Items with nutrition:     {s['items_with_nutrition']}")
        print(f"Successfully parsed:      {s['successfully_parsed']}")
        print(f"Parse errors:             {s['parse_errors']}")
        print(f"Items without nutrition:  {s['items_without_nutrition']}")
        if parsed_items:
            print("\nSample (first item):")
            print(json.dumps(parsed_items[0], indent=2))

    return result


if __name__ == "__main__":
    input_file = os.getenv("COSTCO_JSON_PATH", "./costco-items.json")
    output_file = os.getenv("COSTCO_NUTRITION_OUTPUT", None)

    if len(sys.argv) > 1:
        input_file = sys.argv[1]
    if len(sys.argv) > 2:
        output_file = sys.argv[2]

    try:
        parse_json_file(input_file, output_file)
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
