import logging
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .db import init_pool, close_pool
from .routes.embed_routes import router as embed_router
from .routes.generate_routes import router as gen_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    yield
    close_pool()


app = FastAPI(title="MealGen RAG Service", lifespan=lifespan)

app.include_router(embed_router)
app.include_router(gen_router)


@app.get("/health")
def health():
    return {"ok": True}
