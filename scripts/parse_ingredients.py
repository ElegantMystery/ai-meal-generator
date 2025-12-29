#!/usr/bin/env python3
"""
Parse unstructured ingredients text from Trader Joe's items and extract structured data.

This script parses ingredients text like:
"PORK, SEA SALT, CONTAINS 2% OR LESS OF CULTURED SWISS CHARD POWDER, DEXTROSE..."

And extracts structured fields like:
- ingredients_list (array of main ingredients)
- contains_less_than (array of ingredients in "CONTAINS X% OR LESS OF" clauses)
- ingredients_raw (original text)
- ingredients_count (number of main ingredients)
"""

import json
import re
from typing import Dict, Optional, Any, List


def parse_ingredients_text(ingredients_text: str) -> Optional[Dict[str, Any]]:
    """
    Parse unstructured ingredients text into structured data.
    
    Returns a dictionary with parsed ingredients, or None if parsing fails.
    """
    if not ingredients_text or not isinstance(ingredients_text, str):
        return None
    
    # Clean up the text
    text = ingredients_text.strip()
    if not text:
        return None
    
    result: Dict[str, Any] = {
        "ingredients_raw": text,
    }
    
    # Split by common separators (colon, semicolon) for multi-section ingredients
    # e.g., "SALAMI: PORK, SALT. CHEESE: MILK, SALT."
    sections = re.split(r'[;:]', text)
    
    all_ingredients = []
    contains_less_than = []
    
    for section in sections:
        section = section.strip()
        if not section:
            continue
        
        # Check for "CONTAINS X% OR LESS OF" pattern
        # This pattern can appear in the middle of a comma-separated list
        # e.g., "PORK, SALT, CONTAINS 2% OR LESS OF X, Y, Z."
        # We need to capture everything from "CONTAINS" to the end of the string or a period
        contains_match = re.search(
            r',?\s*CONTAINS\s+(\d+(?:\.\d+)?)\s*%\s*OR\s*LESS\s+OF\s+(.+?)(?=\.\s*$|$)',
            section,
            re.IGNORECASE | re.DOTALL
        )
        
        if contains_match:
            percentage = contains_match.group(1)
            ingredients_part = contains_match.group(2).strip()
            
            # Remove trailing period if present
            ingredients_part = ingredients_part.rstrip('.')
            
            # Split the ingredients in the "contains less than" clause
            less_than_ingredients = split_ingredients(ingredients_part)
            
            contains_less_than.append({
                "percentage": float(percentage),
                "ingredients": less_than_ingredients
            })
            
            # Remove this entire "CONTAINS X% OR LESS OF ..." part from the section
            # This removes everything from the comma before "CONTAINS" to the end
            section = re.sub(
                r',?\s*CONTAINS\s+\d+(?:\.\d+)?\s*%\s*OR\s*LESS\s+OF\s+.*$',
                '',
                section,
                flags=re.IGNORECASE | re.DOTALL
            ).strip()
            
            # Also remove any trailing comma
            section = section.rstrip(',').strip()
        
        # Handle parentheses (sub-ingredients)
        # e.g., "RICE (WATER, RICE)" -> main: "RICE", sub: ["WATER", "RICE"]
        paren_match = re.search(r'^([^(]+)\s*\(([^)]+)\)', section)
        if paren_match:
            main_part = paren_match.group(1).strip()
            sub_part = paren_match.group(2).strip()
            
            # Add main ingredient
            main_ingredients = split_ingredients(main_part)
            all_ingredients.extend(main_ingredients)
            
            # Add sub-ingredients with indication they're nested
            sub_ingredients = split_ingredients(sub_part)
            for sub in sub_ingredients:
                all_ingredients.append({
                    "name": sub["name"],
                    "is_sub_ingredient": True,
                    "parent": main_ingredients[-1]["name"] if main_ingredients else None
                })
        else:
            # No parentheses, just split by comma
            ingredients = split_ingredients(section)
            all_ingredients.extend(ingredients)
    
    # Clean up and normalize ingredients
    cleaned_ingredients = []
    seen = set()
    
    for ing in all_ingredients:
        if isinstance(ing, dict):
            name = ing.get("name", "").strip()
        else:
            name = str(ing).strip()
        
        if not name:
            continue
        
        # Normalize: remove extra whitespace, handle common variations
        name = re.sub(r'\s+', ' ', name)
        name = name.upper()  # Normalize to uppercase for consistency
        
        # Skip duplicates (case-insensitive)
        name_lower = name.lower()
        if name_lower in seen:
            continue
        seen.add(name_lower)
        
        if isinstance(ing, dict):
            ing["name"] = name
            cleaned_ingredients.append(ing)
        else:
            cleaned_ingredients.append({"name": name})
    
    result["ingredients_list"] = cleaned_ingredients
    result["ingredients_count"] = len(cleaned_ingredients)
    
    if contains_less_than:
        result["contains_less_than"] = contains_less_than
    
    # Only return if we extracted at least one ingredient
    if cleaned_ingredients:
        return result
    
    return None


def split_ingredients(text: str) -> List[Dict[str, Any]]:
    """
    Split a comma-separated ingredient list into individual ingredients.
    
    Returns a list of ingredient dictionaries.
    """
    if not text:
        return []
    
    # Split by comma, but be careful with nested structures
    # Simple approach: split by comma and clean each part
    parts = re.split(r',\s*(?![^(]*\))', text)  # Don't split inside parentheses
    
    ingredients = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        
        # Remove trailing periods
        part = part.rstrip('.')
        
        # Remove common prefixes/suffixes that aren't part of the ingredient name
        part = re.sub(r'^(AND|OR)\s+', '', part, flags=re.IGNORECASE)
        
        if part:
            ingredients.append({
                "name": part.strip()
            })
    
    return ingredients


def parse_json_file(input_path: str, output_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Parse ingredients data from tj-items.json and create structured output.
    
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
    items_without_ingredients = []
    
    for idx, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        
        sku = item.get("sku", f"unknown_{idx}")
        name = item.get("name", "Unknown")
        ingredients_text = item.get("ingredients")
        
        if not ingredients_text:
            items_without_ingredients.append({"sku": sku, "name": name})
            continue
        
        parsed = parse_ingredients_text(ingredients_text)
        
        if parsed:
            parsed_items.append({
                "sku": sku,
                "name": name,
                "ingredients_parsed": parsed,
                "ingredients_raw": ingredients_text  # Keep original for reference
            })
        else:
            parse_errors.append({
                "sku": sku,
                "name": name,
                "ingredients_text": ingredients_text[:200]  # First 200 chars for debugging
            })
    
    result = {
        "summary": {
            "total_items": len(data),
            "items_with_ingredients_text": len(data) - len(items_without_ingredients),
            "successfully_parsed": len(parsed_items),
            "parse_errors": len(parse_errors),
            "items_without_ingredients": len(items_without_ingredients)
        },
        "parsed_items": parsed_items,
        "parse_errors": parse_errors,  # All parse errors included
        "items_without_ingredients": items_without_ingredients  # All items without ingredients included
    }
    
    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"✅ Parsed ingredients data saved to: {output_path}")
    else:
        # Print summary
        print("=" * 60)
        print("INGREDIENTS PARSING SUMMARY")
        print("=" * 60)
        print(f"Total items: {result['summary']['total_items']}")
        print(f"Items with ingredients text: {result['summary']['items_with_ingredients_text']}")
        print(f"Successfully parsed: {result['summary']['successfully_parsed']}")
        print(f"Parse errors: {result['summary']['parse_errors']}")
        print(f"Items without ingredients: {result['summary']['items_without_ingredients']}")
        print()
        
        if parsed_items:
            print("Sample parsed ingredients (first item):")
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
    output_file = os.getenv("TJ_INGREDIENTS_PARSED_OUTPUT", None)
    
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

