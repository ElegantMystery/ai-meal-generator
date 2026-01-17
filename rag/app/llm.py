import json
import logging
from openai import OpenAI
from .config import OPENAI_API_KEY, CHAT_MODEL

logger = logging.getLogger(__name__)
client = OpenAI(api_key=OPENAI_API_KEY)

def call_mealplan_llm(system: str, user_payload: dict, temperature: float = 0.4) -> str:
    # Build user message with dietary constraints
    user_message = "Return ONLY valid JSON with this shape:\n"
    user_message += "{title, startDate, endDate, plan:[{date, meals:[{name, items:[{id,name}]}]}]}\n"
    user_message += "Use only items from the provided items list.\n"
    
    # Add dietary style instructions if present - use formatted version
    prefs = user_payload.get("preferences", {})
    dietary_style = prefs.get("dietaryRestrictions")
    if dietary_style:
        # Format consistently with query text
        dietary_style_formatted = dietary_style.replace("-", " ").title()
        # Provide specific guidance for vegetarian to avoid over-filtering
        if dietary_style.lower() == "vegetarian":
            user_message += f"\nImportant: Follow {dietary_style_formatted} diet (no meat or fish, but eggs and dairy are allowed). Select items from the provided list that comply with this diet. If an item's ingredients are unclear, err on the side of including it. Include meals (Breakfast, Lunch, Dinner) only when you have suitable items.\n"
        else:
            user_message += f"\nImportant: Follow {dietary_style_formatted} dietary requirements. Only select items from the provided list that comply with this diet. Include meals (Breakfast, Lunch, Dinner) only when you have suitable items.\n"
    
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_message},
        {"role": "user", "content": json.dumps(user_payload)}
    ]
    
    # Log the complete input to OpenAI API
    logger.info("OpenAI API call - Model: %s, Temperature: %s", CHAT_MODEL, temperature)
    #logger.info("OpenAI API call - Messages: %s", json.dumps(messages, indent=2, ensure_ascii=False))
    
    completion = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=messages,
        temperature=temperature
    )
    
    response_content = completion.choices[0].message.content or ""
    logger.info("OpenAI API response - Length: %d characters", len(response_content))
    logger.info("OpenAI API response - Content: %s", response_content)
    
    return response_content
