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
3. **Implement using `/tdd-workflow`:**
   - Write tests first (RED), implement to pass (GREEN), refactor (IMPROVE)
   - Test locally: run `npm run dev` / `mvn spring-boot:run` and verify manually
   - Run test suite: `npm test` (frontend) or `mvn test` (backend) — must pass
4. **Run `/code-review`** — fix all CRITICAL and HIGH issues before proceeding
5. **Push and create PR** — only if tests pass and code review is clean
   - `git push origin feat/<feature-name>`
   - `gh pr create --base main --head feat/<feature-name>`

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

## Production Observability

AWS CloudWatch is the central observability layer. All resources are declared in `infra/cloudwatch.tf`.

### Log Groups (30-day retention)

| Log Group | Source | How |
|-----------|--------|-----|
| `/meal-gen/prod/backend` | Spring Boot | `awslogs` Docker driver |
| `/meal-gen/prod/rag` | FastAPI | `awslogs` Docker driver |
| `/meal-gen/prod/nginx` | nginx | CloudWatch Agent reads host-mounted `/opt/meal-gen/nginx-logs/` |

### Tailing logs in production

`docker logs` does **not** work for backend/RAG in prod (awslogs driver). Use AWS CLI:
```bash
aws logs tail /meal-gen/prod/backend --follow --region us-east-1
aws logs tail /meal-gen/prod/rag     --follow --region us-east-1
aws logs tail /meal-gen/prod/nginx   --follow --region us-east-1
```

### Auth event MDC markers

Spring Boot emits structured MDC fields on every auth path — these drive CloudWatch metric filters:

| `mdc.event` value | Trigger | `mdc.provider` |
|-------------------|---------|----------------|
| `SIGNUP_SUCCESS` | New user registered | `local` or `google` |
| `LOGIN_SUCCESS` | Successful local login | `local` |
| `OAUTH_LOGIN_SUCCESS` | Successful Google OAuth login | `google` |
| `LOGIN_FAILED` | Wrong password or OAuth-only user tried local login | `local` or `google` |

`mdc.sourceIp` is also set (real client IP via `X-Forwarded-For`). Log messages use user **ID only** — email addresses are never written to logs.

### Custom Metrics

| Metric | Namespace | Alarm |
|--------|-----------|-------|
| `SignupCount` | `MealGen/Auth` | — |
| `LoginCount` | `MealGen/Auth` | — |
| `OAuthLoginCount` | `MealGen/Auth` | — |
| `LoginFailedCount` | `MealGen/Auth` | **MealGen-HighLoginFailures** (>10 in 5 min → SNS email) |
| `Http2xxCount` | `MealGen/HTTP` | — |
| `Http4xxCount` | `MealGen/HTTP` | — |
| `Http5xxCount` | `MealGen/HTTP` | — |

### Dashboard

**MealGen-Prod** in CloudWatch console (us-east-1) — Auth Events chart, HTTP Status chart, Recent Auth Events live table.

### Useful Logs Insights queries

```
# Recent auth events
SOURCE '/meal-gen/prod/backend'
| fields @timestamp, mdc.event, mdc.provider, message
| filter mdc.event in ['SIGNUP_SUCCESS','LOGIN_SUCCESS','OAUTH_LOGIN_SUCCESS','LOGIN_FAILED']
| sort @timestamp desc | limit 50

# Signups per day
SOURCE '/meal-gen/prod/backend'
| filter mdc.event = 'SIGNUP_SUCCESS'
| stats count() as signups by bin(1d)

# nginx 5xx errors
SOURCE '/meal-gen/prod/nginx'
| fields @timestamp, uri, status, request_time
| filter status >= 500 | sort @timestamp desc
```

### CloudWatch Agent

Runs on the EC2 host; config at `cloudwatch/amazon-cloudwatch-agent.json` (deployed by CI/CD on every push).

Check agent status on EC2:
```bash
ssh -i ~/.ssh/meal-gen-key.pem ec2-user@54.205.145.93
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status
```

**On a new EC2 instance:** `user_data` in `infra/ec2.tf` installs the agent automatically. For the existing instance it was installed manually once.

### Terraform — adding/changing CloudWatch resources

Set `alert_email` in `infra/terraform.tfvars` (gitignored), then:
```bash
cd infra && terraform apply
```

To change the alert email only: `terraform apply -target=aws_sns_topic_subscription.alerts_email`

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
