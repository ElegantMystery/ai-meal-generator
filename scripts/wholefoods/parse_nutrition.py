#!/usr/bin/env python3
"""
Parse unstructured nutrition text from Whole Foods items and extract structured data.

WF nutrition is scraped from <section class="w-pie--nutrition-facts"> HTML, producing
text like:
  "Serving Size 1 cup (240mL) Servings Per Container 2 Calories 70 Total Fat 0g ..."

Output schema matches the TJ pipeline for consistent DB storage.

Usage:
  python3 parse_nutrition.py wholefoods-items.json [wholefoods-nutrition-parsed.json]
"""

import json
import re
import sys
import os
from typing import Dict, Optional, Any


def parse_nutrition_text(nutrition_text: str) -> Optional[Dict[str, Any]]:
    """Parse unstructured WF nutrition facts text into structured data."""
    if not nutrition_text or not isinstance(nutrition_text, str):
        return None

    text = nutrition_text.strip()
    result: Dict[str, Any] = {}

    # Serving size: "Serving Size X (Yg)" or "Serving Size X"
    ss_match = re.search(r"Serving\s+Size\s+([^(]+?)(?:\s*\(([^)]+)\))?\s*(?=Servings|Calories|$)", text, re.IGNORECASE)
    if ss_match:
        result["serving_size_text"] = ss_match.group(1).strip()
        paren = ss_match.group(2)
        if paren:
            wt = re.search(r"([\d.]+)\s*g", paren)
            if wt:
                try:
                    result["serving_size_grams"] = float(wt.group(1))
                except ValueError:
                    pass

    # Servings per container
    spc_match = re.search(r"Servings?\s+Per\s+Container\s+(About\s+)?([\d.]+)", text, re.IGNORECASE)
    if spc_match:
        try:
            result["serving_count"] = int(float(spc_match.group(2)))
        except ValueError:
            pass

    # Calories
    cal_match = re.search(r"Calories\s+([\d]+)", text, re.IGNORECASE)
    if cal_match:
        try:
            result["calories"] = int(cal_match.group(1))
        except ValueError:
            pass

    def extract_nutrient(pattern: str) -> Optional[float]:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            return None
        val = match.group(1)
        lt = re.search(r"less\s*than\s*([\d.]+)", val, re.IGNORECASE)
        if lt:
            try:
                return float(lt.group(1))
            except ValueError:
                return 0.0
        num = re.search(r"([\d.]+)", val)
        if num:
            try:
                return float(num.group(1))
            except ValueError:
                return None
        return None

    result["total_fat_g"]          = extract_nutrient(r"Total\s+Fat\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*g")
    result["saturated_fat_g"]      = extract_nutrient(r"Saturated\s+Fat\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*g")
    result["trans_fat_g"]          = extract_nutrient(r"Trans\s+Fat\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*g")
    result["cholesterol_mg"]       = extract_nutrient(r"Cholesterol\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*mg")
    result["sodium_mg"]            = extract_nutrient(r"Sodium\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*mg")
    result["total_carbohydrate_g"] = extract_nutrient(r"Total\s+Carbohydrate\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*g")
    result["dietary_fiber_g"]      = extract_nutrient(r"Dietary\s+Fiber\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*g")
    result["total_sugars_g"]       = extract_nutrient(r"Total\s+Sugars\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*g")
    result["added_sugars_g"]       = extract_nutrient(r"Added\s+Sugars\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*g")
    result["protein_g"]            = extract_nutrient(r"Protein\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*g")
    result["vitamin_d_mcg"]        = extract_nutrient(r"Vitamin\s+D\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*mcg")
    result["calcium_mg"]           = extract_nutrient(r"Calcium\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*mg")
    result["iron_mg"]              = extract_nutrient(r"Iron\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*mg")
    result["potassium_mg"]         = extract_nutrient(r"Potassium\s*((?:Less\s+[Tt]han\s+)?[\d.]+)\s*mg")

    # Only return if we extracted calories at minimum
    if "calories" in result:
        return result
    return None


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

        if not nutrition_raw or not isinstance(nutrition_raw, str):
            items_without_nutrition.append({"sku": sku, "name": name})
            continue

        parsed = parse_nutrition_text(nutrition_raw)
        if parsed:
            parsed_items.append({
                "sku": sku,
                "name": name,
                "nutrition_parsed": parsed,
                "nutrition_raw": nutrition_raw,
            })
        else:
            parse_errors.append({
                "sku": sku,
                "name": name,
                "nutrition_text": nutrition_raw[:200],
            })

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
        print(f"✅ Parsed nutrition saved to: {output_path}")
    else:
        s = result["summary"]
        print("=" * 60)
        print("NUTRITION PARSING SUMMARY (Whole Foods)")
        print("=" * 60)
        print(f"Total items:            {s['total_items']}")
        print(f"Items with nutrition:   {s['items_with_nutrition']}")
        print(f"Successfully parsed:    {s['successfully_parsed']}")
        print(f"Parse errors:           {s['parse_errors']}")
        print(f"Items without nutrition:{s['items_without_nutrition']}")
        if parsed_items:
            print("\nSample (first item):")
            print(json.dumps(parsed_items[0], indent=2))

    return result


if __name__ == "__main__":
    input_file = sys.argv[1] if len(sys.argv) > 1 else os.getenv("WF_JSON_PATH", "./wholefoods-items.json")
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        parse_json_file(input_file, output_file)
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
