import os

DATABASE_URL = os.getenv("DATABASE_URL")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
RAG_SHARED_SECRET = os.getenv("RAG_SHARED_SECRET", "")

EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4.1-mini")

RETRIEVAL_K = int(os.getenv("RETRIEVAL_K", "120"))
