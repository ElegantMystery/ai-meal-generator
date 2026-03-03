#!/usr/bin/env python3
"""
Parse unstructured nutrition text from Trader Joe's items and extract structured data.

This script parses nutrition facts text like:
"Nutrition FactsServes 6serving size1/2 packet(20g/about 1 Tbsp. chopped)calories per serving30..."

And extracts structured fields like:
- serving_count
- serving_size_text
- serving_size_grams
- calories
- fat, saturated_fat, trans_fat
- cholesterol, sodium
- total_carbohydrate, dietary_fiber, total_sugars, added_sugars
- protein
- vitamins and minerals
"""

import json
import re
from typing import Dict, Optional, Any


def parse_nutrition_text(nutrition_text: str) -> Optional[Dict[str, Any]]:
    """
    Parse unstructured nutrition facts text into structured data.
    
    Returns a dictionary with parsed nutrition values, or None if parsing fails.
    """
    if not nutrition_text or not isinstance(nutrition_text, str):
        return None
    
    # Remove the "NOTE: Since posting..." disclaimer at the end
    note_pattern = r"NOTE:.*$"
    text = re.sub(note_pattern, "", nutrition_text, flags=re.DOTALL | re.IGNORECASE)
    
    result: Dict[str, Any] = {}
    
    # Extract "Serves X" or "Serves about X"
    serves_match = re.search(r"Serves\s+(?:about\s+)?(\d+)", text, re.IGNORECASE)
    if serves_match:
        result["serving_count"] = int(serves_match.group(1))
    
    # Extract serving size: "serving size" followed by description and optional weight
    # Pattern: "serving size" followed by text, then optional "(XXg" or "(XX g"
    # Note: no space between "size" and the description in some cases
    serving_size_match = re.search(
        r"serving\s+size\s*([^(]+)", 
        text, 
        re.IGNORECASE
    )
    if serving_size_match:
        serving_size_text = serving_size_match.group(1).strip()
        result["serving_size_text"] = serving_size_text
        
        # Try to extract weight in grams from parentheses
        weight_match = re.search(r"\((\d+(?:\.\d+)?)\s*g", text, re.IGNORECASE)
        if weight_match:
            try:
                result["serving_size_grams"] = float(weight_match.group(1))
            except ValueError:
                pass
    
    # Extract calories per serving (note: no space between "serving" and number in some cases)
    calories_match = re.search(r"calories\s+per\s+serving\s*(\d+)", text, re.IGNORECASE)
    if calories_match:
        result["calories"] = int(calories_match.group(1))
    
    # Helper function to extract nutrient values
    def extract_nutrient(pattern: str, text: str) -> Optional[float]:
        """Extract a nutrient value (number + unit) from text."""
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                value_str = match.group(1)
                # Handle "less than" cases (e.g., "less than 1g")
                if "less than" in value_str.lower() or "lessthan" in value_str.lower():
                    # Extract the number after "less than" or "lessthan"
                    less_than_match = re.search(r"(?:less\s*than|lessthan)\s*(\d+(?:\.\d+)?)", value_str, re.IGNORECASE)
                    if less_than_match:
                        return float(less_than_match.group(1))
                    return 0.0
                return float(value_str)
            except (ValueError, AttributeError):
                return None
        return None
    
    # Extract macronutrients (note: no space between nutrient name and number in some cases)
    # Handle "less than" cases like "less than 1g" or "lessthan1g"
    result["total_fat_g"] = extract_nutrient(r"Total\s+Fat\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*g", text)
    result["saturated_fat_g"] = extract_nutrient(r"Saturated\s+Fat\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*g", text)
    result["trans_fat_g"] = extract_nutrient(r"Trans\s+Fat\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*g", text)
    result["cholesterol_mg"] = extract_nutrient(r"Cholesterol\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*mg", text)
    result["sodium_mg"] = extract_nutrient(r"Sodium\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*mg", text)
    result["total_carbohydrate_g"] = extract_nutrient(r"Total\s+Carbohydrate\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*g", text)
    result["dietary_fiber_g"] = extract_nutrient(r"Dietary\s+Fiber\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*g", text)
    result["total_sugars_g"] = extract_nutrient(r"Total\s+Sugars\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*g", text)
    result["added_sugars_g"] = extract_nutrient(r"Added\s+Sugars\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*g", text)
    result["protein_g"] = extract_nutrient(r"Protein\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*g", text)
    
    # Extract vitamins and minerals
    result["vitamin_d_mcg"] = extract_nutrient(r"Vitamin\s+D\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*mcg", text)
    result["calcium_mg"] = extract_nutrient(r"Calcium\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*mg", text)
    result["iron_mg"] = extract_nutrient(r"Iron\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*mg", text)
    result["potassium_mg"] = extract_nutrient(r"Potassium\s*((?:less\s*than\s*|lessthan\s*)?[\d.]+)\s*mg", text)
    
    # Only return result if we extracted at least calories (minimum useful data)
    if "calories" in result:
        return result
    
    return None


def parse_json_file(input_path: str, output_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Parse nutrition data from tj-items.json and create structured output.
    
    Args:
        input_path: Path to input JSON file
        output_path: Optional path to save parsed results. If None, prints summary.
    
    Returns:
        Dictionary with parsing statistics and sample results
    """
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
        nutrition_text = item.get("nutrition")
        
        if not nutrition_text:
            items_without_nutrition.append({"sku": sku, "name": name})
            continue
        
        parsed = parse_nutrition_text(nutrition_text)
        
        if parsed:
            parsed_items.append({
                "sku": sku,
                "name": name,
                "nutrition_parsed": parsed,
                "nutrition_raw": nutrition_text  # Keep original for reference
            })
        else:
            parse_errors.append({
                "sku": sku,
                "name": name,
                "nutrition_text": nutrition_text[:200]  # First 200 chars for debugging
            })
    
    result = {
        "summary": {
            "total_items": len(data),
            "items_with_nutrition_text": len(data) - len(items_without_nutrition),
            "successfully_parsed": len(parsed_items),
            "parse_errors": len(parse_errors),
            "items_without_nutrition": len(items_without_nutrition)
        },
        "parsed_items": parsed_items,
        "parse_errors": parse_errors,  # All parse errors included
        "items_without_nutrition": items_without_nutrition  # All items without nutrition included
    }
    
    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"✅ Parsed nutrition data saved to: {output_path}")
    else:
        # Print summary
        print("=" * 60)
        print("NUTRITION PARSING SUMMARY")
        print("=" * 60)
        print(f"Total items: {result['summary']['total_items']}")
        print(f"Items with nutrition text: {result['summary']['items_with_nutrition_text']}")
        print(f"Successfully parsed: {result['summary']['successfully_parsed']}")
        print(f"Parse errors: {result['summary']['parse_errors']}")
        print(f"Items without nutrition: {result['summary']['items_without_nutrition']}")
        print()
        
        if parsed_items:
            print("Sample parsed nutrition (first item):")
            print(json.dumps(parsed_items[0], indent=2))
            print()
        
        if parse_errors:
            print("Sample parse errors (first error):")
            print(json.dumps(parse_errors[0], indent=2))
    
    return result


if __name__ == "__main__":
    import sys
    import os
    
    input_file = os.getenv("TJ_JSON_PATH", "./tj-items.json")
    output_file = os.getenv("TJ_PARSED_OUTPUT", None)
    
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

