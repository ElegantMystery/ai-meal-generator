#!/usr/bin/env python3
"""
Parse unstructured ingredients text from Whole Foods items and extract structured data.

WF ingredients are scraped from <h4>Ingredients</h4><p>TEXT</p> HTML, producing
plain-text strings like:
  "ENRICHED FLOUR (WHEAT FLOUR, NIACIN, ...), SUGAR, PALM OIL, ..."

Output schema matches the TJ pipeline for consistent DB storage.

Usage:
  python3 parse_ingredients.py wholefoods-items.json [wholefoods-ingredients-parsed.json]
"""

import json
import re
import sys
import os
from typing import Dict, Optional, Any, List


def split_ingredients(text: str) -> List[Dict[str, Any]]:
    """Split a comma-separated ingredient list respecting parentheses."""
    if not text:
        return []
    parts = re.split(r",\s*(?![^(]*\))", text)
    ingredients = []
    for part in parts:
        part = part.strip().rstrip(".")
        part = re.sub(r"^(AND|OR)\s+", "", part, flags=re.IGNORECASE)
        if part:
            ingredients.append({"name": part.strip()})
    return ingredients


def parse_ingredients_text(ingredients_text: str) -> Optional[Dict[str, Any]]:
    """Parse unstructured WF ingredients text into structured data."""
    if not ingredients_text or not isinstance(ingredients_text, str):
        return None

    text = ingredients_text.strip()
    if not text:
        return None

    result: Dict[str, Any] = {"ingredients_raw": text}

    # Split into sections on semicolons/colons (e.g. "CHEESE: MILK, SALT. SALAMI: PORK, SALT.")
    sections = re.split(r"[;:]", text)

    all_ingredients: List[Dict[str, Any]] = []
    contains_less_than = []

    for section in sections:
        section = section.strip()
        if not section:
            continue

        # Extract "CONTAINS X% OR LESS OF ..." clauses
        contains_match = re.search(
            r",?\s*CONTAINS\s+(\d+(?:\.\d+)?)\s*%\s*OR\s*LESS\s+OF\s+(.+?)(?=\.\s*$|$)",
            section,
            re.IGNORECASE | re.DOTALL,
        )
        if contains_match:
            percentage = contains_match.group(1)
            less_part = contains_match.group(2).strip().rstrip(".")
            contains_less_than.append({
                "percentage": float(percentage),
                "ingredients": split_ingredients(less_part),
            })
            section = re.sub(
                r",?\s*CONTAINS\s+\d+(?:\.\d+)?\s*%\s*OR\s*LESS\s+OF\s+.*$",
                "",
                section,
                flags=re.IGNORECASE | re.DOTALL,
            ).strip().rstrip(",").strip()

        all_ingredients.extend(split_ingredients(section))

    # Deduplicate and normalize
    cleaned: List[Dict[str, Any]] = []
    seen: set = set()
    for ing in all_ingredients:
        name = re.sub(r"\s+", " ", ing.get("name", "").strip()).upper()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        cleaned.append({"name": name})

    result["ingredients_list"] = cleaned
    result["ingredients_count"] = len(cleaned)
    if contains_less_than:
        result["contains_less_than"] = contains_less_than

    return result if cleaned else None


def parse_json_file(input_path: str, output_path: Optional[str] = None) -> Dict[str, Any]:
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
        ingredients_raw = item.get("ingredients")

        if not ingredients_raw or not isinstance(ingredients_raw, str):
            items_without_ingredients.append({"sku": sku, "name": name})
            continue

        parsed = parse_ingredients_text(ingredients_raw)
        if parsed:
            parsed_items.append({
                "sku": sku,
                "name": name,
                "ingredients_parsed": parsed,
                "ingredients_raw": ingredients_raw,
            })
        else:
            parse_errors.append({
                "sku": sku,
                "name": name,
                "ingredients_text": ingredients_raw[:200],
            })

    result = {
        "summary": {
            "total_items": len(data),
            "items_with_ingredients": len(data) - len(items_without_ingredients),
            "successfully_parsed": len(parsed_items),
            "parse_errors": len(parse_errors),
            "items_without_ingredients": len(items_without_ingredients),
        },
        "parsed_items": parsed_items,
        "parse_errors": parse_errors,
        "items_without_ingredients": items_without_ingredients,
    }

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"✅ Parsed ingredients saved to: {output_path}")
    else:
        s = result["summary"]
        print("=" * 60)
        print("INGREDIENTS PARSING SUMMARY (Whole Foods)")
        print("=" * 60)
        print(f"Total items:               {s['total_items']}")
        print(f"Items with ingredients:    {s['items_with_ingredients']}")
        print(f"Successfully parsed:       {s['successfully_parsed']}")
        print(f"Parse errors:              {s['parse_errors']}")
        print(f"Items without ingredients: {s['items_without_ingredients']}")
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
