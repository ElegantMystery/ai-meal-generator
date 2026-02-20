# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Meal Generator is a full-stack meal planning application with three services:
- **Frontend**: Next.js 16 (React 19) with Tailwind CSS
- **Backend**: Spring Boot 4.0 (Java 21) with PostgreSQL and Flyway migrations
- **RAG Service**: FastAPI (Python) for AI-powered meal plan generation using OpenAI

## Architecture

```
Frontend (3000) → Backend (8080) → RAG Service (8000)
                       ↓                  ↓
                  PostgreSQL (5432) with pgvector
```

The backend handles user auth (Google OAuth2), meal plan CRUD, and preferences. For AI generation, it calls the RAG service which:
1. Embeds the query using OpenAI text-embedding-3-small
2. Retrieves top-K candidate items via vector similarity (pgvector HNSW indexes)
3. Calls GPT-4.1-mini to generate a meal plan JSON
4. Validates item IDs exist in the store

Two generation modes exist: rule-based (`/api/mealplans/generate`) and AI-powered (`/api/mealplans/generate-ai`).

## Git Workflow

**Always follow this workflow for every new feature or task:**

1. `git pull origin main` — sync with latest main
2. `git checkout -b feat/<feature-name>` — create a new feature branch
3. Implement the feature (with TDD where applicable)
4. Open a PR to merge back into `main`

Never commit new features directly to `main`. Each feature gets its own branch.

## Development Commands

### Full Stack (Docker Compose)
```bash
export OPENAI_API_KEY=<your-key>
docker-compose up --build
```

### Backend (Java 21 / Maven)
```bash
cd backend
mvn spring-boot:run                    # Run dev server on :8080
mvn clean package                      # Build JAR
mvn flyway:migrate                     # Run DB migrations manually
mvn flyway:info                        # Check migration status
mvn test                               # Run tests
```

**Important:** After creating new Flyway migration files (e.g., `V025__*.sql`), you must run `mvn flyway:migrate` to apply them to the database before testing. When using Docker Compose, migrations run automatically on startup.

### Frontend (Node / npm)
```bash
cd frontend
npm install
npm run dev                            # Dev server on :3000
npm run build                          # Production build
npm run lint                           # ESLint
```

### RAG Service (Python / FastAPI)
**Important:** Always use the project-level virtual environment at `.venv/` for Python dependencies.
```bash
source .venv/bin/activate                          # Activate venv first
cd rag
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000   # Run dev server
```

### Database
PostgreSQL 18 with pgvector extension. Run via Docker:
```bash
docker run --name postgres-mealgen -e POSTGRES_DB=mealgen \
  -e POSTGRES_USER=meal_user -e POSTGRES_PASSWORD=236810 \
  -p 5432:5432 pgvector/pgvector:pg18
```

## Key Configuration

### Environment Variables (RAG)
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - OpenAI API key
- `RAG_SHARED_SECRET` - Shared secret for backend→RAG auth (header: `X-RAG-SECRET`)
- `EMBED_MODEL` - Embedding model (default: `text-embedding-3-small`)
- `CHAT_MODEL` - Chat model (default: `gpt-4.1-mini`)
- `RETRIEVAL_K` - Top-K candidates for vector search (default: 120)

### Backend Config
- `backend/src/main/resources/application.yaml` - Spring config
- `mealgen.rag.base-url` / `mealgen.rag.secret` - RAG service connection

### Frontend
- API base URL hardcoded in `frontend/lib/api.ts` (localhost:8080)

## Project Structure

```
backend/
├── src/main/java/com/mealgen/backend/
│   ├── auth/           # OAuth2, User entity
│   ├── items/          # Grocery items CRUD
│   ├── mealplan/       # Meal plans, RagClient, ShoppingList
│   ├── preferences/    # User dietary preferences
│   └── security/       # Spring Security config
└── src/main/resources/db/migration/  # Flyway SQL migrations (V1-V026)

frontend/
├── app/                # Next.js app router pages
│   ├── dashboard/      # Main meal plan dashboard
│   ├── settings/       # User preferences
│   └── mealplans/[id]/ # Individual meal plan view
├── components/         # React components
└── lib/               # API client, Zustand auth store

rag/app/
├── routes/
│   ├── generate_routes.py   # POST /generate endpoint
│   └── embed_routes.py      # Embedding backfill endpoints
├── embedding.py        # OpenAI embedding calls
├── retrieval.py        # Vector similarity search
├── llm.py             # GPT-4.1-mini meal plan generation
└── validators.py      # JSON validation, ID extraction
```

## Database Schema

Key tables (managed by Flyway):
- `users` - Users (supports OAuth2 and local email/password auth, tracks onboarding status)
- `user_preferences` - Dietary restrictions, allergies, calorie targets
- `items` - Grocery items with store, price, category
- `meal_plans` - Generated meal plans (JSON stored in `plan_json`)
- `item_embeddings`, `item_nutrition_embeddings`, `item_ingredients_embeddings` - Vector embeddings with HNSW indexes

## API Endpoints

### Backend REST API (port 8080)
- `POST /api/auth/signup` - Register with email/password
- `POST /api/auth/login` - Login with email/password
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout
- `POST /api/auth/complete-onboarding` - Mark user onboarding as completed
- `GET /oauth2/authorization/google` - Google OAuth2 login
- `GET/POST/DELETE /api/mealplans` - Meal plan CRUD
- `POST /api/mealplans/generate` - Rule-based generation
- `POST /api/mealplans/generate-ai` - AI RAG generation
- `GET /api/mealplans/{id}/shopping-list` - Generate shopping list
- `GET/PUT /api/preferences/me` - User preferences

### RAG Service (port 8000)
- `POST /generate` - AI meal plan generation (requires X-RAG-SECRET header)
- `POST /embed/backfill/*` - Populate vector embeddings
- `GET /health` - Health check
