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

def embed_texts(texts: List[str]) -> List[List[float]]:
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [d.embedding for d in resp.data]

def embed_one(text: str) -> List[float]:
    return embed_texts([text])[0]
