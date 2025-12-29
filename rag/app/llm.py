import json
import logging
from openai import OpenAI
from .config import OPENAI_API_KEY, CHAT_MODEL

logger = logging.getLogger(__name__)
client = OpenAI(api_key=OPENAI_API_KEY)

def call_mealplan_llm(system: str, user_payload: dict, temperature: float = 0.4) -> str:
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content":
            "Return ONLY valid JSON with this shape:\n"
            "{title, startDate, endDate, plan:[{date, meals:[{name, items:[{id,name}]}]}]}\n"
            "Use only items from the provided items list."
        },
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
    
    return response_content
