import json
import logging
from typing import Any, Dict, List

from openai import OpenAI
from .config import OPENAI_API_KEY, EMBED_MODEL

logger = logging.getLogger(__name__)
client = OpenAI(api_key=OPENAI_API_KEY)

def item_doc(i: Dict[str, Any]) -> str:
    return "\n".join([
        f"name: {i.get('name','')}",
        f"store: {i.get('store','')}",
        f"category: {i.get('category_path','')}",
        f"unit: {i.get('unit_size','')}",
        f"price: {i.get('price','')}",
        f"tags: {json.dumps(i.get('tags_json')) if i.get('tags_json') is not None else ''}",
    ])

def nutrition_doc(nutrition_data: Dict[str, Any]) -> str:
    """
    Create a document string from nutrition data.
    Handles both parsed JSON format and raw text format.
    """
    parts = []
    
    # Check if nutrition is stored as JSON string (parsed format)
    nutrition_text = nutrition_data.get('nutrition', '')
    if isinstance(nutrition_text, str):
        try:
            # Try to parse as JSON
            nutrition_json = json.loads(nutrition_text)
            if isinstance(nutrition_json, dict) and 'parsed' in nutrition_json:
                # Use parsed data
                parsed = nutrition_json.get('parsed', {})
                if parsed:
                    parts.append("Nutrition Facts:")
                    if parsed.get('serving_count'):
                        parts.append(f"  Serves: {parsed['serving_count']}")
                    if parsed.get('serving_size_text'):
                        parts.append(f"  Serving size: {parsed['serving_size_text']}")
                    if parsed.get('serving_size_grams'):
                        parts.append(f"  Serving size (grams): {parsed['serving_size_grams']}")
                    if parsed.get('calories') is not None:
                        parts.append(f"  Calories: {parsed['calories']} per serving")
                    if parsed.get('total_fat_g') is not None:
                        parts.append(f"  Total fat: {parsed['total_fat_g']}g")
                    if parsed.get('saturated_fat_g') is not None:
                        parts.append(f"  Saturated fat: {parsed['saturated_fat_g']}g")
                    if parsed.get('trans_fat_g') is not None:
                        parts.append(f"  Trans fat: {parsed['trans_fat_g']}g")
                    if parsed.get('cholesterol_mg') is not None:
                        parts.append(f"  Cholesterol: {parsed['cholesterol_mg']}mg")
                    if parsed.get('sodium_mg') is not None:
                        parts.append(f"  Sodium: {parsed['sodium_mg']}mg")
                    if parsed.get('total_carbohydrate_g') is not None:
                        parts.append(f"  Total carbohydrate: {parsed['total_carbohydrate_g']}g")
                    if parsed.get('dietary_fiber_g') is not None:
                        parts.append(f"  Dietary fiber: {parsed['dietary_fiber_g']}g")
                    if parsed.get('total_sugars_g') is not None:
                        parts.append(f"  Total sugars: {parsed['total_sugars_g']}g")
                    if parsed.get('added_sugars_g') is not None:
                        parts.append(f"  Added sugars: {parsed['added_sugars_g']}g")
                    if parsed.get('protein_g') is not None:
                        parts.append(f"  Protein: {parsed['protein_g']}g")
                    if parsed.get('vitamin_d_mcg') is not None:
                        parts.append(f"  Vitamin D: {parsed['vitamin_d_mcg']}mcg")
                    if parsed.get('calcium_mg') is not None:
                        parts.append(f"  Calcium: {parsed['calcium_mg']}mg")
                    if parsed.get('iron_mg') is not None:
                        parts.append(f"  Iron: {parsed['iron_mg']}mg")
                    if parsed.get('potassium_mg') is not None:
                        parts.append(f"  Potassium: {parsed['potassium_mg']}mg")
                # Fall back to raw if parsed is empty
                if not parts or len(parts) == 1:
                    raw_text = nutrition_json.get('raw', '')
                    if raw_text:
                        parts = [f"Nutrition: {raw_text[:1000]}"]  # Limit length
            else:
                # Not in expected format, use as-is (raw text)
                if nutrition_text:
                    parts.append(f"Nutrition: {nutrition_text[:1000]}")
        except (json.JSONDecodeError, TypeError):
            # Not JSON, treat as raw text
            if nutrition_text:
                parts.append(f"Nutrition: {nutrition_text[:1000]}")
    
    return "\n".join(parts) if parts else ""

def ingredients_doc(ingredients_data: Dict[str, Any]) -> str:
    """
    Create a document string from ingredients data.
    Handles both parsed JSON format and raw text format.
    """
    parts = []
    
    # Check if ingredients is stored as JSON string (parsed format)
    ingredients_text = ingredients_data.get('ingredients', '')
    if isinstance(ingredients_text, str):
        try:
            # Try to parse as JSON
            ingredients_json = json.loads(ingredients_text)
            if isinstance(ingredients_json, dict) and 'parsed' in ingredients_json:
                # Use parsed data
                parsed = ingredients_json.get('parsed', {})
                if parsed:
                    parts.append("Ingredients:")
                    ingredients_list = parsed.get('ingredients_list', [])
                    if ingredients_list:
                        # Extract main ingredients (not sub-ingredients)
                        main_ingredients = [
                            ing.get('name', '') 
                            for ing in ingredients_list 
                            if not ing.get('is_sub_ingredient', False)
                        ]
                        if main_ingredients:
                            parts.append(f"  Main ingredients: {', '.join(main_ingredients)}")
                        
                        # Include sub-ingredients with context
                        sub_ingredients = [
                            ing for ing in ingredients_list 
                            if ing.get('is_sub_ingredient', False)
                        ]
                        if sub_ingredients:
                            for sub in sub_ingredients:
                                parent = sub.get('parent', '')
                                name = sub.get('name', '')
                                if parent and name:
                                    parts.append(f"  {parent} contains: {name}")
                    
                    # Include "contains less than" information
                    contains_less_than = parsed.get('contains_less_than', [])
                    if contains_less_than:
                        for ct in contains_less_than:
                            percentage = ct.get('percentage', 0)
                            ing_list = ct.get('ingredients', [])
                            ing_names = [ing.get('name', '') for ing in ing_list if ing.get('name')]
                            if ing_names:
                                parts.append(f"  Contains {percentage}% or less of: {', '.join(ing_names)}")
                    
                    # Fall back to raw if parsed is empty
                    if not parts or len(parts) == 1:
                        raw_text = ingredients_json.get('raw', '')
                        if raw_text:
                            parts = [f"Ingredients: {raw_text[:1000]}"]  # Limit length
            else:
                # Not in expected format, use as-is (raw text)
                if ingredients_text:
                    parts.append(f"Ingredients: {ingredients_text[:1000]}")
        except (json.JSONDecodeError, TypeError):
            # Not JSON, treat as raw text
            if ingredients_text:
                parts.append(f"Ingredients: {ingredients_text[:1000]}")
    
    return "\n".join(parts) if parts else ""

def embed_texts(texts: List[str]) -> List[List[float]]:
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [d.embedding for d in resp.data]

def embed_one(text: str) -> List[float]:
    return embed_texts([text])[0]
