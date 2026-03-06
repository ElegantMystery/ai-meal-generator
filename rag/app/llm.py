import json
import logging
from openai import OpenAI
from .config import OPENAI_API_KEY, CHAT_MODEL

logger = logging.getLogger(__name__)
client = OpenAI(api_key=OPENAI_API_KEY)

# ---------------------------------------------------------------------------
# System prompt — dish-centric, serving-aware meal planning
# ---------------------------------------------------------------------------
_SYSTEM_PROMPT = """You are a home cook planning a week of meals from a grocery store's inventory.

## Thinking process for EVERY dish:
1. Name the dish first (e.g. "Spaghetti Meatballs", "Veggie Omelette", "Overnight Oats with Berries and Nuts").
2. List the raw ingredients needed to actually COOK or ASSEMBLE it.
3. Find each ingredient in the items list. Use the closest available match.
4. Build the dish with those item IDs.

## What counts as a real dish:
A dish must use at least 3 items that TOGETHER form a recipe — a raw or base ingredient PLUS accompaniments or cooking components.

GOOD examples:
- "Spaghetti Meatballs" → [Angus Beef Meatballs, Spaghetti, Tomato Basil Pasta Sauce, Shredded Parmesan Cheese]
- "Chicken Stir-Fry with Rice" → [Boneless Chicken Thighs, Broccoli Florets, Jasmine Rice, Soy Sauce, Sesame Oil]
- "Veggie Omelette" → [Eggs, Baby Spinach, Bell Peppers, Feta Cheese, Olive Oil]
- "Overnight Oats" → [Rolled Oats, Whole Milk or Almond Milk, Greek Yogurt, Fresh Berries, Honey]
- "Salmon with Roasted Veggies" → [Salmon Fillets, Olive Oil, Lemon, Asparagus, Cherry Tomatoes]
- "Tuna Salad Sandwich" → [Canned Tuna, Whole Grain Bread, Avocado, Celery, Greek Yogurt or Mayo]

BAD examples — these are convenience products, NOT dishes:
- "Grilled Chili Lime Chicken Breast" → [Grilled Chili Lime Chicken Breast] — pre-cooked product listed alone
- "Lemon Chicken & Arugula Salad" → [Lemon Chicken & Arugula Salad, Arugula] — pre-made product + one add-on
- "Caesar Salad Kit" → [Caesar Salad Kit] — kit is not a dish
- "Mediterranean Orzo Pasta Salad" → [Mediterranean Style Orzo Pasta Salad, Feta] — pre-made salad + one add-on
- "Overnight Oats" → [Vanilla Overnight Oats] — the pre-made product IS the product, not a dish

## Ingredient hierarchy — follow this strictly:
TIER 1 (must appear in most dishes): fresh vegetables, fresh meat/seafood, eggs, fresh fruit
TIER 2 (supporting roles): dairy, cheese, olive oil, broth, canned tomatoes, pasta, rice, beans, bread
TIER 3 (accent only): sauces, dressings, condiments, spices
TIER 4 (avoid unless no alternative): pre-cooked proteins, salad kits, frozen meals, deli grab-and-go items

A dish should have at least one TIER 1 ingredient. Tier 4 items should be rare and always combined with Tier 1/2.

## Meal-specific guidance:
- Breakfast: eggs cooked various ways + vegetables/cheese, OR oats/grain + fresh fruit + yogurt/milk/nuts. Not a pre-made breakfast product alone.
- Lunch: raw salad built from fresh greens + protein + toppings, OR sandwich/wrap with fresh ingredients, OR soup with fresh vegetables + protein.
- Dinner: protein (fresh meat/fish) + fresh vegetable side + starch, with a sauce or cooking fat. Should feel like a real home-cooked dinner.

## servingsUsed — how much of the package is used in ONE dish preparation:
Think about how much of that product a real cook would actually use for one meal:
- Fresh proteins (chicken breast, salmon, ground beef): 1–2 servings (the actual portion)
- Fresh vegetables (broccoli, spinach, tomatoes): 1–2 servings
- Eggs: 2–3 (you crack 2-3 eggs per omelette)
- Dairy / cheese: 0.5–1 serving (a handful of shredded cheese, a dollop of yogurt)
- Pasta / rice / grains (dry): 2–4 servings (you cook multiple servings at once)
- Canned goods (beans, tomatoes, tuna): 1–2 servings (use most of the can)
- Bread / tortillas: 1–2 servings (1–2 slices or wraps)
- PANTRY STAPLES — use a tiny fraction per dish:
  - Olive oil / cooking oil: 0.1–0.2 servings (a drizzle or tablespoon)
  - Vinegar / soy sauce / hot sauce / condiments: 0.1–0.2 servings (a splash)
  - Spices / dried herbs: 0.05–0.1 servings (a pinch or teaspoon)
  - Lemon / lime (used for juice): 0.3–0.5 servings (squeeze half a lemon)
  - Broth / stock: 0.5–1 serving (a cup or two from a large carton)
  - Honey / maple syrup: 0.1–0.2 servings (a drizzle)
  - Butter: 0.1–0.2 servings (a pat)

## Other rules:
- Every dish needs at least 3 items.
- Reuse pantry staples (olive oil, rice, pasta) across multiple meals — they have high serving counts.
- Vary proteins and vegetables across days.
- No dish repeated more than twice per week.
- Respect dietary restrictions, allergies, and calorie targets.
- Only use item IDs and names from the provided list. Never invent items.
- Return ONLY valid JSON — no markdown, no explanation."""

# ---------------------------------------------------------------------------
# JSON schema template shown to the LLM
# ---------------------------------------------------------------------------
_SCHEMA_DESCRIPTION = """\
Return a single JSON object with this exact shape:
{
  "title": "<descriptive plan title>",
  "startDate": "<YYYY-MM-DD>",
  "endDate": "<YYYY-MM-DD>",
  "plan": [
    {
      "date": "<YYYY-MM-DD>",
      "meals": [
        {
          "name": "Breakfast" | "Lunch" | "Dinner",
          "dishes": [
            {
              "dishName": "<human-readable dish name>",
              "description": "<one sentence description>",
              "estimatedCalories": <integer>,
              "items": [
                { "id": <integer>, "name": "<exact item name>", "servingsUsed": <float> }
              ]
            }
          ]
        }
      ]
    }
  ]
}

Notes:
- "items" inside each dish must contain only items from the provided list.
- Do NOT include a top-level "items" key inside meals — it will be populated automatically.
- Each dish must have at least 3 items forming a real recipe.
- Each meal must have 1–2 dishes.
- servingsUsed is a float. Pantry staples (oil, vinegar, spices, lemon) must be 0.05–0.3. A whole bottle of olive oil is NOT used in one salad.
"""


def call_mealplan_llm(system: str, user_payload: dict, temperature: float = 0.4, recipes: list | None = None) -> str:
    prefs = user_payload.get("preferences", {})
    dietary_style = prefs.get("dietaryRestrictions")
    allergies = prefs.get("allergies")
    calorie_target = prefs.get("targetCaloriesPerDay")

    # Build the human-readable constraints block
    constraint_lines = []

    if dietary_style and dietary_style != "none":
        dietary_style_formatted = dietary_style.replace("-", " ").title()
        if dietary_style.lower() == "vegetarian":
            constraint_lines.append(
                f"Dietary style: {dietary_style_formatted} "
                "(no meat or fish; eggs and dairy are allowed)."
            )
        else:
            constraint_lines.append(f"Dietary style: {dietary_style_formatted}.")

    if allergies:
        constraint_lines.append(f"Allergies to avoid: {allergies}.")

    if calorie_target:
        constraint_lines.append(
            f"Target calories per day: ~{calorie_target} kcal "
            "(distribute across all meals)."
        )

    constraints_block = (
        "\n".join(constraint_lines) if constraint_lines else "No specific dietary constraints."
    )

    recipes_block = ""
    if recipes:
        recipes_block = (
            "\n\n## Recipe inspiration (use these as dish IDEAS — do NOT copy ingredients literally):\n"
            "These are real recipes. Use them to name dishes and identify what raw ingredients a dish needs. "
            "Then find those ingredients in the items list and build the dish from store items.\n"
            + json.dumps(recipes, ensure_ascii=False)
        )

    user_message = (
        f"{_SCHEMA_DESCRIPTION}\n"
        f"Constraints:\n{constraints_block}"
        f"{recipes_block}\n\n"
        "For each meal: (1) decide a dish name (use the recipe inspiration above for ideas), "
        "(2) identify its raw ingredients, (3) find those ingredients in the items list below, (4) build the dish. "
        "Every dish needs at least 3 ingredients. Fresh produce, meat, eggs, and dairy should be the stars — pantry items are the supporting cast. "
        "Items with a high serving_count should appear in multiple meals across the week."
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_message},
        {"role": "user", "content": json.dumps(user_payload)},
    ]

    logger.info("OpenAI API call - Model: %s, Temperature: %s", CHAT_MODEL, temperature)

    completion = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=messages,
        temperature=temperature,
    )

    response_content = completion.choices[0].message.content or ""
    logger.info("OpenAI API response - Length: %d characters", len(response_content))
    logger.debug("OpenAI API response - Content: %s", response_content)

    return response_content


def get_dish_system_prompt() -> str:
    """Return the dish-centric system prompt (useful for testing / inspection)."""
    return _SYSTEM_PROMPT
