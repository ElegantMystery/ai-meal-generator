#!/usr/bin/env python3
"""
Parse ingredients data from costco-items.json.

Costco ingredients come as plain-text strings scraped from PDP HTML, e.g.:
  "WHOLE WHEAT FLOUR, SUGAR, PALM OIL, CONTAINS 2% OR LESS OF SALT."

The parser reuses the same logic as the TJ pipeline since the ingredients
format is standard across grocery stores.

Output schema matches tj-ingredients-parsed.json exactly.

Usage:
    python parse_ingredients.py <input_items.json> <output_parsed.json>

Environment variables:
    COSTCO_JSON_PATH               -- input file (overridden by positional arg 1)
    COSTCO_INGREDIENTS_OUTPUT      -- output file (overridden by positional arg 2)
"""

import json
import os
import re
import sys
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Ingredients parser (identical to TJ's logic — format is store-agnostic)
# ---------------------------------------------------------------------------

def split_ingredients(text: str) -> List[Dict[str, Any]]:
    """Split a comma-separated ingredients string into a list of dicts."""
    if not text:
        return []
    parts = re.split(r",\s*(?![^(]*\))", text)  # don't split inside parens
    ingredients = []
    for part in parts:
        part = part.strip().rstrip(".")
        part = re.sub(r"^(AND|OR)\s+", "", part, flags=re.IGNORECASE)
        if part:
            ingredients.append({"name": part.strip()})
    return ingredients


def parse_ingredients_text(ingredients_text: str) -> Optional[Dict[str, Any]]:
    """
    Parse a plain-text ingredients string into structured data.
    Returns None if parsing fails or yields no ingredients.
    """
    if not ingredients_text or not isinstance(ingredients_text, str):
        return None

    text = ingredients_text.strip()
    if not text:
        return None

    result: Dict[str, Any] = {"ingredients_raw": text}
    sections = re.split(r"[;:]", text)

    all_ingredients: List[Dict[str, Any]] = []
    contains_less_than = []

    for section in sections:
        section = section.strip()
        if not section:
            continue

        # Extract "CONTAINS X% OR LESS OF …" clause
        contains_match = re.search(
            r",?\s*CONTAINS\s+(\d+(?:\.\d+)?)\s*%\s*OR\s*LESS\s+OF\s+(.+?)(?=\.\s*$|$)",
            section,
            re.IGNORECASE | re.DOTALL,
        )
        if contains_match:
            percentage = contains_match.group(1)
            ingredients_part = contains_match.group(2).strip().rstrip(".")
            contains_less_than.append(
                {
                    "percentage": float(percentage),
                    "ingredients": split_ingredients(ingredients_part),
                }
            )
            section = re.sub(
                r",?\s*CONTAINS\s+\d+(?:\.\d+)?\s*%\s*OR\s*LESS\s+OF\s+.*$",
                "",
                section,
                flags=re.IGNORECASE | re.DOTALL,
            ).strip().rstrip(",").strip()

        # Handle parenthetical sub-ingredients
        paren_match = re.search(r"^([^(]+)\s*\(([^)]+)\)", section)
        if paren_match:
            main_ingredients = split_ingredients(paren_match.group(1).strip())
            sub_ingredients = split_ingredients(paren_match.group(2).strip())
            all_ingredients.extend(main_ingredients)
            for sub in sub_ingredients:
                all_ingredients.append(
                    {
                        "name": sub["name"],
                        "is_sub_ingredient": True,
                        "parent": main_ingredients[-1]["name"] if main_ingredients else None,
                    }
                )
        else:
            all_ingredients.extend(split_ingredients(section))

    # Deduplicate and normalise
    cleaned: List[Dict[str, Any]] = []
    seen: set = set()
    for ing in all_ingredients:
        name = re.sub(r"\s+", " ", (ing.get("name") or "").strip()).upper()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        entry = dict(ing)
        entry["name"] = name
        cleaned.append(entry)

    result["ingredients_list"] = cleaned
    result["ingredients_count"] = len(cleaned)
    if contains_less_than:
        result["contains_less_than"] = contains_less_than

    return result if cleaned else None


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
    items_without_ingredients = []

    for idx, item in enumerate(data):
        if not isinstance(item, dict):
            continue

        sku = item.get("sku", f"unknown_{idx}")
        name = item.get("name", "Unknown")
        ingredients_raw = item.get("ingredients")

        if not ingredients_raw:
            items_without_ingredients.append({"sku": sku, "name": name})
            continue

        # Structured list (e.g. from Costco API returning pre-parsed ingredients)
        if isinstance(ingredients_raw, list):
            ingredients_list = [
                {"name": entry.get("ingredient", entry.get("name", "")).strip()}
                for entry in ingredients_raw
                if isinstance(entry, dict)
                and (entry.get("ingredient") or entry.get("name", "")).strip()
            ]
            if not ingredients_list:
                items_without_ingredients.append({"sku": sku, "name": name})
                continue
            parsed_items.append(
                {
                    "sku": sku,
                    "name": name,
                    "ingredients_parsed": {
                        "ingredients_raw": ", ".join(e["name"] for e in ingredients_list),
                        "ingredients_list": ingredients_list,
                        "ingredients_count": len(ingredients_list),
                    },
                    "ingredients_raw": ingredients_raw,
                }
            )
            continue

        # Plain-text string
        if isinstance(ingredients_raw, str):
            parsed = parse_ingredients_text(ingredients_raw)
            if parsed:
                parsed_items.append(
                    {
                        "sku": sku,
                        "name": name,
                        "ingredients_parsed": parsed,
                        "ingredients_raw": ingredients_raw,
                    }
                )
            else:
                parse_errors.append(
                    {
                        "sku": sku,
                        "name": name,
                        "ingredients_text": ingredients_raw[:200],
                    }
                )
            continue

        items_without_ingredients.append({"sku": sku, "name": name})

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
        print(f"✅ Parsed ingredients data saved to: {output_path}")
    else:
        s = result["summary"]
        print("=" * 60)
        print("COSTCO INGREDIENTS PARSING SUMMARY")
        print("=" * 60)
        print(f"Total items:                {s['total_items']}")
        print(f"Items with ingredients:     {s['items_with_ingredients']}")
        print(f"Successfully parsed:        {s['successfully_parsed']}")
        print(f"Parse errors:               {s['parse_errors']}")
        print(f"Items without ingredients:  {s['items_without_ingredients']}")
        if parsed_items:
            print("\nSample (first item):")
            print(json.dumps(parsed_items[0], indent=2))

    return result


if __name__ == "__main__":
    input_file = os.getenv("COSTCO_JSON_PATH", "./costco-items.json")
    output_file = os.getenv("COSTCO_INGREDIENTS_OUTPUT", None)

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
