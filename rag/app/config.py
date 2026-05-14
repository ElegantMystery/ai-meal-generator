import logging
import os

DATABASE_URL = os.getenv("DATABASE_URL")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
RAG_SHARED_SECRET = os.getenv("RAG_SHARED_SECRET", "")

EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-5.2")

RETRIEVAL_K = int(os.getenv("RETRIEVAL_K", "200"))

MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY")
ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "https://api.minimax.io/anthropic")
AGENT_MODEL = os.getenv("AGENT_MODEL", "MiniMax-M2.7")
AGENT_MAX_TURNS = int(os.getenv("AGENT_MAX_TURNS", "25"))

if MINIMAX_API_KEY and not os.environ.get("ANTHROPIC_API_KEY"):
    os.environ["ANTHROPIC_API_KEY"] = MINIMAX_API_KEY
os.environ.setdefault("ANTHROPIC_BASE_URL", ANTHROPIC_BASE_URL)

if not MINIMAX_API_KEY:
    logging.getLogger(__name__).warning(
        "MINIMAX_API_KEY not set — agent generation will fail."
    )
