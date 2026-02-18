import logging
from contextlib import contextmanager
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row
from pgvector.psycopg import register_vector

from .config import DATABASE_URL

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None


def init_pool():
    global _pool
    if not DATABASE_URL:
        logger.error("DATABASE_URL is not set")
        raise RuntimeError("DATABASE_URL is not set")

    _pool = ConnectionPool(
        DATABASE_URL,
        min_size=2,
        max_size=10,
        kwargs={"row_factory": dict_row},
    )
    logger.info("Database connection pool initialized")


def close_pool():
    global _pool
    if _pool:
        _pool.close()
        _pool = None
        logger.info("Database connection pool closed")


@contextmanager
def get_conn():
    if _pool is None:
        init_pool()

    with _pool.connection() as conn:
        register_vector(conn)
        yield conn
