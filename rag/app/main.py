import logging
import sys
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from .routes.embed_routes import router as embed_router
from .routes.generate_routes import router as gen_router

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="MealGen RAG Service")

app.include_router(embed_router)
app.include_router(gen_router)

@app.get("/health")
def health():
    return {"ok": True}
