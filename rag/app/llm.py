import json
from openai import OpenAI
from .config import OPENAI_API_KEY, CHAT_MODEL

client = OpenAI(api_key=OPENAI_API_KEY)

def call_mealplan_llm(system: str, user_payload: dict, temperature: float = 0.4) -> str:
    completion = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content":
                "Return ONLY valid JSON with this shape:\n"
                "{title, startDate, endDate, plan:[{date, meals:[{name, items:[{id,name}]}]}]}\n"
                "Use only items from the provided items list."
            },
            {"role": "user", "content": json.dumps(user_payload)}
        ],
        temperature=temperature
    )
    return completion.choices[0].message.content or ""
