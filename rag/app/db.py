import logging
import psycopg
from psycopg.rows import dict_row
from pgvector.psycopg import register_vector

from .config import DATABASE_URL

logger = logging.getLogger(__name__)

def get_conn():
    if not DATABASE_URL:
        logger.error("DATABASE_URL is not set")
        raise RuntimeError("DATABASE_URL is not set")

    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    register_vector(conn)
    return conn
