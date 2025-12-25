import os
import json
import logging
from datetime import date, timedelta
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import psycopg
from psycopg.rows import dict_row
from pgvector.psycopg import register_vector

from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="MealGen RAG Service")

DATABASE_URL = os.getenv("DATABASE_URL")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SHARED_SECRET = os.getenv("RAG_SHARED_SECRET", "")

client = OpenAI(api_key=OPENAI_API_KEY)


def auth(secret: Optional[str]):
  if SHARED_SECRET and secret != SHARED_SECRET:
    raise HTTPException(status_code=401, detail="Unauthorized")


def get_conn():
  if not DATABASE_URL:
    logger.error("DATABASE_URL is not set")
    raise RuntimeError("DATABASE_URL is not set")
  try:
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    register_vector(conn)
    logger.debug("Database connection established successfully")
    return conn
  except Exception as e:
    logger.error(f"Failed to connect to database: {str(e)}", exc_info=True)
    raise


# ---- Models ----
class Preferences(BaseModel):
  dietaryRestrictions: Optional[str] = None
  dislikedIngredients: Optional[str] = None
  targetCaloriesPerDay: Optional[int] = None

class GenerateRequest(BaseModel):
  userId: int
  store: str
  days: int
  preferences: Preferences

class GenerateResponse(BaseModel):
  title: str
  startDate: str
  endDate: str
  planJson: str


# ---- Helpers ----
def item_doc(i: Dict[str, Any]) -> str:
  # Make embedding text stable + compact
  return "\n".join([
    f"name: {i.get('name','')}",
    f"store: {i.get('store','')}",
    f"category: {i.get('category_path','')}",
    f"unit: {i.get('unit_size','')}",
    f"price: {i.get('price','')}",
    f"tags: {json.dumps(i.get('tags_json')) if i.get('tags_json') is not None else ''}",
  ])

def embed_texts(texts: List[str]) -> List[List[float]]:
  # Use a cheaper embedding model to start
  logger.debug(f"Calling OpenAI embeddings API for {len(texts)} texts")
  try:
    resp = client.embeddings.create(
      model="text-embedding-3-small",
      input=texts
    )
    embeddings = [d.embedding for d in resp.data]
    logger.debug(f"Generated {len(embeddings)} embeddings, dimension: {len(embeddings[0]) if embeddings else 0}")
    return embeddings
  except Exception as e:
    logger.error(f"Error generating embeddings: {str(e)}", exc_info=True)
    raise

def embed_one(text: str) -> List[float]:
  return embed_texts([text])[0]


# ---- Endpoint A: Backfill embeddings (Option B) ----
class BackfillRequest(BaseModel):
  store: Optional[str] = None
  limit: int = 200

class BackfillResponse(BaseModel):
  updated: int
  skipped: int

@app.post("/embed/backfill", response_model=BackfillResponse)
def backfill_embeddings(req: BackfillRequest, x_rag_secret: Optional[str] = Header(default=None)):
  auth(x_rag_secret)
  
  logger.info(f"Starting backfill embeddings - store: {req.store}, limit: {req.limit}")

  updated = 0
  skipped = 0

  with get_conn() as conn:
    with conn.cursor() as cur:
      # Find items without embeddings by checking item_embeddings table
      if req.store:
        logger.debug(f"Querying items for store: {req.store}")
        cur.execute("""
          SELECT i.id, i.store, i.name, i.category_path, i.unit_size, i.price, i.tags_json
          FROM items i
          LEFT JOIN item_embeddings ie ON i.id = ie.item_id
          WHERE i.store ILIKE %s AND ie.item_id IS NULL
          ORDER BY i.id
          LIMIT %s
        """, (req.store, req.limit))
      else:
        logger.debug("Querying all items without embeddings")
        cur.execute("""
          SELECT i.id, i.store, i.name, i.category_path, i.unit_size, i.price, i.tags_json
          FROM items i
          LEFT JOIN item_embeddings ie ON i.id = ie.item_id
          WHERE ie.item_id IS NULL
          ORDER BY i.id
          LIMIT %s
        """, (req.limit,))

      rows = cur.fetchall()
      logger.info(f"Found {len(rows)} items without embeddings")
      
      if not rows:
        logger.info("No items found to process")
        return BackfillResponse(updated=0, skipped=0)

      logger.info(f"Generating embeddings for {len(rows)} items")
      texts = [item_doc(r) for r in rows]
      vectors = embed_texts(texts)
      logger.debug(f"Generated {len(vectors)} embeddings successfully")

      # Insert or update embeddings in item_embeddings table
      logger.info("Inserting/updating embeddings in database")
      for r, v in zip(rows, vectors):
        cur.execute("""
          INSERT INTO item_embeddings (item_id, embedding, updated_at)
          VALUES (%s, %s, CURRENT_TIMESTAMP)
          ON CONFLICT (item_id) DO UPDATE
          SET embedding = EXCLUDED.embedding, updated_at = CURRENT_TIMESTAMP
        """, (r["id"], v))
        updated += 1

    conn.commit()
    logger.info(f"Committed {updated} embeddings to database")

  logger.info(f"Backfill completed - updated: {updated}, skipped: {skipped}")
  return BackfillResponse(updated=updated, skipped=skipped)


# ---- Endpoint B: Generate plan with retrieval + LLM (Option A) ----
@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest, x_rag_secret: Optional[str] = Header(default=None)):
  auth(x_rag_secret)
  
  logger.info(f"Generating meal plan - userId: {req.userId}, store: {req.store}, days: {req.days}")

  if req.days < 1 or req.days > 14:
    logger.warning(f"Invalid days parameter: {req.days}")
    raise HTTPException(status_code=400, detail="days must be between 1 and 14")

  # 1) Build retrieval query from preferences
  query_text = f"""
  Create a {req.days}-day meal plan using {req.store} grocery items.
  Dietary restrictions: {req.preferences.dietaryRestrictions or "none"}.
  Disliked ingredients: {req.preferences.dislikedIngredients or "none"}.
  Target calories per day: {req.preferences.targetCaloriesPerDay or "not specified"}.
  Prefer variety and practical meals.
  """.strip()

  logger.debug("Generating query embedding")
  qvec = embed_one(query_text)
  logger.debug(f"Query embedding generated, dimension: {len(qvec)}")

  # 2) Retrieve top-K items by vector similarity from Postgres
  # NOTE: this uses pgvector operator <=> for cosine distance ordering
  # Joins items with item_embeddings table
  logger.info(f"Searching for similar items in store: {req.store}")
  with get_conn() as conn:
    with conn.cursor() as cur:
      cur.execute("""
        SELECT i.id, i.name, i.price, i.unit_size, i.category_path, i.image_url
        FROM items i
        INNER JOIN item_embeddings ie ON i.id = ie.item_id
        WHERE i.store ILIKE %s
        ORDER BY ie.embedding <=> %s::vector
        LIMIT 80
      """, (req.store, qvec))

      candidates = cur.fetchall()

  logger.info(f"Found {len(candidates)} candidate items")
  
  if not candidates:
    logger.warning(f"No embedded items found for store: {req.store}")
    raise HTTPException(status_code=400, detail="No embedded items found for that store. Run /embed/backfill first.")

  # 3) Ask LLM to produce structured JSON plan
  # Keep output schema stable
  start = date.today()
  end = start + timedelta(days=req.days - 1)
  logger.debug(f"Meal plan date range: {start} to {end}")

  system = "You are a meal-planning assistant. Only use the provided items."
  user = {
    "store": req.store,
    "days": req.days,
    "startDate": str(start),
    "preferences": req.preferences.model_dump(),
    "items": candidates
  }

  logger.info(f"Calling LLM to generate meal plan with {len(candidates)} items")
  try:
    # Use JSON output discipline: we ask for JSON only
    completion = client.chat.completions.create(
      model="gpt-4.1-mini",
      messages=[
        {"role": "system", "content": system},
        {"role": "user", "content": "Return ONLY valid JSON with this shape:\n"
                                   "{title, startDate, endDate, plan:[{date, meals:[{name, items:[{id,name}]}]}]}\n"
                                   "Use only items from the provided items list."},
        {"role": "user", "content": json.dumps(user)}
      ],
      temperature=0.4
    )
    logger.debug("LLM completion received successfully")
  except Exception as e:
    logger.error(f"Error calling LLM: {str(e)}", exc_info=True)
    raise HTTPException(status_code=500, detail=f"Error calling LLM: {str(e)}")

  content = completion.choices[0].message.content
  if not content:
    logger.error("LLM returned empty response")
    raise HTTPException(status_code=500, detail="LLM returned empty response")

  # Validate it's JSON
  try:
    parsed = json.loads(content)
    logger.debug("Successfully parsed LLM response as JSON")
  except json.JSONDecodeError as e:
    logger.error(f"LLM response is not valid JSON: {str(e)}")
    logger.debug(f"LLM response content (first 500 chars): {content[:500]}")
    raise HTTPException(status_code=500, detail="LLM did not return valid JSON")

  title = parsed.get("title") or f"AI Meal Plan ({req.store}, {req.days} days)"
  parsed["title"] = title
  parsed["startDate"] = parsed.get("startDate") or str(start)
  parsed["endDate"] = parsed.get("endDate") or str(end)

  logger.info(f"Meal plan generated successfully - title: {title}")
  return GenerateResponse(
    title=title,
    startDate=parsed["startDate"],
    endDate=parsed["endDate"],
    planJson=json.dumps(parsed)
  )
