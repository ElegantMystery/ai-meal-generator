import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from .db import close_pool, get_conn, init_pool
from .routes.embed_routes import router as embed_router
from .routes.generate_routes import router as gen_router
from .security import validate_security_configuration

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    validate_security_configuration()
    init_pool()
    try:
        yield
    finally:
        close_pool()


app = FastAPI(title="MealGen RAG Service", lifespan=lifespan)

app.include_router(embed_router)
app.include_router(gen_router)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/ready")
def readiness():
    try:
        with get_conn() as conn:
            conn.execute("SELECT 1")
    except Exception as exc:
        logging.getLogger(__name__).warning("RAG readiness check failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="RAG service is not ready") from exc
    return {"status": "UP", "database": "UP"}
