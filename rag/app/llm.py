import json
import logging
from openai import OpenAI
from .config import OPENAI_API_KEY, CHAT_MODEL

logger = logging.getLogger(__name__)
client = OpenAI(api_key=OPENAI_API_KEY)

# ---------------------------------------------------------------------------
# System prompt — dish-centric, serving-aware meal planning
# ---------------------------------------------------------------------------
_SYSTEM_PROMPT = """You are a meal-planning assistant. Your job is to create practical,
dish-centric meal plans using only the grocery items provided.

Rules:
1. Each meal contains one or more DISHES (e.g., "Overnight Oats", "Veggie Stir-Fry").
2. Each dish combines 2–5 store items from the provided list.
3. Set servingsUsed (integer 1–10) to reflect how many servings of that product are used
   in one dish preparation. Items with a high serving_count (6+) may be reused across
   multiple meals — reflect this by including them in multiple dishes.
4. Respect all dietary restrictions, allergies, and calorie targets provided.
5. Vary dishes across days — avoid repeating the same dish on consecutive days.
6. Only use item IDs and names from the provided items list — do not invent items.
7. Keep estimatedCalories realistic based on the items in each dish.
8. Return ONLY valid JSON — no markdown, no commentary."""

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
                { "id": <integer>, "name": "<exact item name>", "servingsUsed": <1-10> }
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
- Each dish must have at least 1 item (ideally 2–5).
- Each meal must have at least 1 dish (ideally 1–3 dishes per meal).
"""


def call_mealplan_llm(system: str, user_payload: dict, temperature: float = 0.4) -> str:
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

    user_message = (
        f"{_SCHEMA_DESCRIPTION}\n"
        f"Constraints:\n{constraints_block}\n\n"
        "Use only the items from the provided list. "
        "Items with a high serving_count should be reused across multiple meals."
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
