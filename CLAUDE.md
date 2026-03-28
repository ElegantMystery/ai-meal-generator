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
1. Retrieves ~120 candidate items via **category-proportional random sampling** (no vector search at generation time — randomness ensures plan variety across runs). Category quotas are **store-aware**: TRADER_JOES uses path-based categories (e.g. "Fresh Fruits & Veggies > Veggies"), while WHOLE_FOODS uses flat labels (e.g. "Produce", "Meat") to ensure balanced representation across different store schemas.
2. Samples 75 **recipe templates** from the `recipes` table (filtered by dietary restriction if set, with unfiltered fallback) and passes them to the LLM as dish-name inspiration
3. Calls GPT-4.1-mini (or configured `CHAT_MODEL`) to generate a dish-centric meal plan JSON
4. Validates item IDs exist in the store

The generated plan's `_meta` includes `recipeTemplatesOffered` (list of recipe titles offered to the LLM) for traceability.

Two generation modes exist: rule-based (`/api/mealplans/generate`) and AI-powered (`/api/mealplans/generate-ai`).

## Subscription & Quota System

The app enforces a **FREE tier (3 plans/month) vs. PRO tier (unlimited)** model via Stripe:

- **FREE users** can generate 3 meal plans per month; the `users.plans_generated_count` counter is incremented on each successful generation
- **PRO users** are granted unlimited generations; status is checked via the `subscriptions` table (active or past_due statuses grant PRO access)
- **Quota enforcement** occurs in `MealPlanGenerateService` before calling the RAG service; exceeding the limit raises `QuotaExceededException` (HTTP 429)
- **Stripe integration** via `SubscriptionService`:
  - Creates Stripe customers on signup (linked via `users.stripe_customer_id`)
  - Checkout sessions redirect to Stripe Hosted Checkout (`STRIPE_PRO_PRICE_ID`); success redirects to `/dashboard?upgrade=success`
  - Billing portal sessions allow users to manage subscriptions
  - Webhooks (`/api/webhooks/stripe`) handle `subscription.updated` → upsert/delete `subscriptions` record, `invoice.payment_succeeded` → mark active
- **Tier resolution** via `subscriptionService.getTier(userId)`: returns PRO if active subscription exists, else FREE

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
aws logs tail /meal-gen/prod/backend  --follow --region us-east-1
aws logs tail /meal-gen/prod/rag      --follow --region us-east-1
aws logs tail /meal-gen/prod/nginx    --follow --region us-east-1
```

### Auth event MDC markers

Spring Boot emits structured MDC fields on every auth path — these drive CloudWatch metric filters:

| `mdc.event` value | Trigger | `mdc.provider` |
|-------------------|---------|----------------|
| `SIGNUP_SUCCESS` | New user registered via Google OAuth | `google` |
| `OAUTH_LOGIN_SUCCESS` | Successful Google OAuth login | `google` |
| `LOGIN_FAILED` | OAuth failure | `google` |

`mdc.sourceIp` is also set (real client IP via `X-Forwarded-For`). Log messages use user **ID only** — email addresses are never written to logs.

### Custom Metrics

| Metric | Namespace | Alarm |
|--------|-----------|-------|
| `SignupCount` | `MealGen/Auth` | — |
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
| filter mdc.event in ['SIGNUP_SUCCESS','OAUTH_LOGIN_SUCCESS','LOGIN_FAILED']
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

**On a new EC2 instance:** `user_data` in `infra/ec2.tf` installs both CloudWatch Agent and SSM Agent automatically.

### Terraform — adding/changing CloudWatch resources

Set `alert_email` in `infra/terraform.tfvars` (gitignored), then:
```bash
cd infra && terraform apply
```

To change the alert email only: `terraform apply -target=aws_sns_topic_subscription.alerts_email`

## Grocery Item Scrapers

The database is populated via two grocery store scraper pipelines: Trader Joe's (manual) and Whole Foods (automated). Both use the same pattern: local/GHA scrape → transfer to EC2 → import to RDS → backfill embeddings.

### TJ Scraper Pipeline

Manual pipeline that scrapes Trader Joe's catalog and keeps the database fresh.
Must be run from a local machine — Akamai blocks datacenter/GHA IPs and only returns ~15 items.

### Architecture

```
Local machine (home IP):
  node scripts/tj/scrape_tj.js  → intercepts TJ GraphQL, paginates ~85 pages
    → tj-items.json, tj-metadata.json

  node scripts/tj/run_pipeline.sh
    → runs scrape_tj.js
    → scp tj-items.json + tj-nutrition-parsed.json + tj-ingredients-parsed.json → EC2:/tmp/

  EC2 (via SSH):
    python3 import_tj.py  → upserts items into RDS (items, item_nutrition, item_ingredients)
    docker exec python-rag curl /embed/backfill/{items,nutrition,ingredients}
```

### Key files

| File | Purpose |
|------|---------|
| `scripts/tj/scrape_tj.js` | Playwright scraper — intercepts TJ GraphQL, outputs `tj-items.json` + parsed files |
| `scripts/tj/run_pipeline.sh` | End-to-end pipeline: scrape → scp to EC2 → import → embed |
| `scripts/tj/import_tj.py` | Upserts items into RDS (`items`, `item_nutrition`, `item_ingredients`) |
| `.github/workflows/tj-scraper.yml` | GHA workflow — exists but **not used** (Akamai blocks GHA IPs) |

### Running the pipeline

```bash
cd scripts/tj
bash run_pipeline.sh
```

This runs the full pipeline: scrape → transfer to EC2 → import to RDS → backfill embeddings.

## Whole Foods Scraper Pipeline

Automated pipeline that scrapes Whole Foods grocery store catalog (store ID: 10259, San Jose CA) and keeps the database fresh.
Runs via GitHub Actions on the 20th of each month. Unlike TJ (blocked by Akamai), GHA runners can access Whole Foods without restrictions.

### Architecture

```
GitHub Actions Runner (monthly on 20th):
  node scripts/wholefoods/scrape_wholefoods.js  → calls Whole Foods API + Playwright for pagination
    → wholefoods-items.json

  python3 scripts/wholefoods/parse_nutrition.py
    → wholefoods-nutrition-parsed.json

  python3 scripts/wholefoods/parse_ingredients.py
    → wholefoods-ingredients-parsed.json

  EC2 (via SSH):
    python3 import_wholefoods.py  → upserts items into RDS (items, item_nutrition, item_ingredients)
    docker exec python-rag curl /embed/backfill/{items,nutrition,ingredients}
```

### Key files

| File | Purpose |
|------|---------|
| `scripts/wholefoods/scrape_wholefoods.js` | Playwright scraper — fetches Whole Foods catalog (store 10259), outputs `wholefoods-items.json` |
| `scripts/wholefoods/parse_nutrition.py` | Parses nutrition data from scraped JSON → `wholefoods-nutrition-parsed.json` |
| `scripts/wholefoods/parse_ingredients.py` | Parses ingredient lists → `wholefoods-ingredients-parsed.json` |
| `scripts/wholefoods/import_wholefoods.py` | Upserts items into RDS (`items`, `item_nutrition`, `item_ingredients`) |
| `scripts/wholefoods/run_pipeline.sh` | End-to-end pipeline: scrape → parse → scp to EC2 → import → embed |
| `.github/workflows/wholefoods-scraper.yml` | GHA workflow — runs 20th of month (monthly refresh) |

### Running the pipeline manually

```bash
cd scripts/wholefoods
bash run_pipeline.sh
```

This runs the full pipeline: scrape → parse → transfer to EC2 → import to RDS → backfill embeddings.

### Automation

The workflow `.github/workflows/wholefoods-scraper.yml` automatically runs on the 20th of each month (via cron schedule `0 0 20 * *`). It:
1. Runs the complete scraper pipeline
2. Transfers parsed data to EC2 via SCP
3. Imports to RDS
4. Backfills vector embeddings

No manual intervention required unless the workflow fails.

## Spoonacular Recipes Pipeline

One-time (and periodic refresh) script that imports popular recipes from Spoonacular into the `recipes` table. These recipes are used as dish-name inspiration at meal plan generation time.

### Key files

| File | Purpose |
|------|---------|
| `scripts/spoonacular/fetch_recipes.py` | Fetch recipes from Spoonacular API, upsert into `recipes` table, optionally backfill `recipe_embeddings` |
| `backend/src/main/resources/db/migration/V027__create_recipes_table.sql` | Flyway migration — creates `recipes` and `recipe_embeddings` tables with GIN indexes on `diets`/`dish_types` |

### Running the import

```bash
source .venv/bin/activate
export DATABASE_URL=postgresql://meal_user:YOUR_DB_PASSWORD@localhost:5432/mealgen
export SPOONACULAR_API_KEY=<your-key>

# Import 300 recipes (default)
python scripts/spoonacular/fetch_recipes.py --total 300

# Import + backfill vector embeddings (requires OPENAI_API_KEY)
python scripts/spoonacular/fetch_recipes.py --total 300 --embed
```

**Free tier:** 150 requests/day. The script paginates in batches of 100 with a 0.5 s delay.

### How recipes are used at generation time

`retrieval.retrieve_recipes(limit=75, dietary_restriction=...)` is called on every `/generate` request:
- If `dietary_restriction` is set (e.g. `vegetarian`), queries `WHERE diets @> ARRAY['vegetarian']`
- Falls back to random unfiltered sample if no matching recipes found (warns to CloudWatch)
- Recipe titles + ingredient lists are injected into the LLM prompt as dish-idea inspiration
- Sampled titles are recorded in `plan_json._meta.recipeTemplatesOffered` for traceability

### LLM serving size guidance

The LLM system prompt in `rag/app/llm.py` includes detailed `servingsUsed` (portion per dish) guidance to ensure realistic meal planning. Key distinctions:

**Small-use fresh produce** (used sparingly):
- Cherry/grape tomatoes: 0.2–0.3 servings (a handful from a pint)
- Fresh herbs (basil, parsley, cilantro, rosemary): 0.1–0.2 servings (a few sprigs)
- Garlic/shallots: 0.1–0.2 servings (1–2 cloves)
- Bell peppers/jalapeños: 0.3–0.5 servings (half a pepper)

**Bulk fresh vegetables** (used in larger quantities):
- Broccoli, spinach, kale, cabbage, zucchini: 1–2 servings

This distinction ensures that small garnish ingredients do not artificially inflate package waste, while bulk vegetables correctly reflect the full-serving consumption pattern.

## Key Configuration

### Environment Variables (Backend)
- `SPRING_DATASOURCE_PASSWORD` - PostgreSQL password
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth2 credentials
- `STRIPE_SECRET_KEY` - Stripe API secret key (sk_test_* for dev, sk_live_* for prod)
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret (whsec_*)
- `STRIPE_PRO_PRICE_ID` - Stripe price ID for PRO subscription tier (price_*)

### Environment Variables (RAG)
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - OpenAI API key
- `RAG_SHARED_SECRET` - Shared secret for backend→RAG auth (header: `X-RAG-SECRET`)
- `EMBED_MODEL` - Embedding model (default: `text-embedding-3-small`) — used for backfill only
- `CHAT_MODEL` - Chat model (default: `gpt-4.1-mini`)
- `SPOONACULAR_API_KEY` - Spoonacular API key — only needed to run `scripts/spoonacular/fetch_recipes.py`

### Backend Config
- `backend/src/main/resources/application.yaml` - Spring config
- `mealgen.rag.base-url` / `mealgen.rag.secret` - RAG service connection
- `stripe.*` - Stripe integration config (secret-key, webhook-secret, price-id, success-url, cancel-url)

### Frontend
- API base URL: `NEXT_PUBLIC_API_BASE_URL` env var (defaults to http://localhost:8080)

## Project Structure

```
backend/
├── src/main/java/com/mealgen/backend/
│   ├── auth/           # OAuth2, User entity with Stripe customer ID
│   ├── items/          # Grocery items CRUD
│   ├── mealplan/       # Meal plans, RagClient, ShoppingList (quota-enforced)
│   ├── preferences/    # User dietary preferences
│   ├── security/       # Spring Security config
│   └── subscription/   # Stripe integration (SubscriptionService, SubscriptionController, StripeWebhookController)
└── src/main/resources/db/migration/  # Flyway SQL migrations (V1-V030)

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
├── embedding.py        # OpenAI embedding calls (backfill only)
├── retrieval.py        # Category-proportional sampling + retrieve_recipes
├── llm.py             # Dish-centric meal plan generation (GPT)
└── validators.py      # JSON validation, float servingsUsed, ID extraction

scripts/
├── tj/                 # Trader Joe's scraper pipeline (manual, local machine only)
├── wholefoods/         # Whole Foods scraper pipeline (automated, GHA monthly)
└── spoonacular/
    └── fetch_recipes.py  # Import popular recipes from Spoonacular API
```

## Database Schema

Key tables (managed by Flyway):
- `users` - Users (Google OAuth2 only); includes `stripe_customer_id` (linked to Stripe) and `plans_generated_count` (quota enforcement)
- `user_preferences` - Dietary restrictions, allergies, calorie targets
- `items` - Grocery items with store, price, category, image_url (TEXT). Stores: TRADER_JOES (2,057 items) and WHOLE_FOODS (7,327 items from San Jose store #10259)
- `item_nutrition` - Nutrition facts per item (calories, macros, etc.)
- `item_ingredients` - Ingredient lists per item
- `mealplans` - Generated meal plans (JSON stored in `plan_json`; `_meta.recipeTemplatesOffered` lists recipes sampled at generation time)
- `recipes` - Recipe dataset (title, ingredients, diets, cuisines, dish_types); currently 300 Spoonacular recipes; GIN indexes on `diets` and `dish_types`
- `recipe_embeddings` - Vector embeddings for recipes (HNSW, 1536-dim); populated via `fetch_recipes.py --embed`
- `item_embeddings`, `item_nutrition_embeddings`, `item_ingredients_embeddings` - Vector embeddings with HNSW indexes
- `subscriptions` - Stripe subscription records (one per active subscriber); tracks status (active/past_due/canceled/unpaid), tier (PRO), billing period, and cancellation status

## API Endpoints

### Backend REST API (port 8080)

#### Authentication
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout
- `POST /api/auth/complete-onboarding` - Mark user onboarding as completed
- `GET /oauth2/authorization/google` - Google OAuth2 login (only auth method)

#### Meal Plans
- `GET/POST/DELETE /api/mealplans` - Meal plan CRUD
- `POST /api/mealplans/generate` - Rule-based generation (quota-enforced for FREE tier, unlimited for PRO)
- `POST /api/mealplans/generate-ai` - AI RAG generation (quota-enforced for FREE tier, unlimited for PRO)
- `GET /api/mealplans/{id}/shopping-list` - Generate shopping list

#### Preferences
- `GET/PUT /api/preferences/me` - User preferences

#### Subscriptions & Billing
- `GET /api/subscription/status` - Get user's current subscription tier, remaining quota (FREE tier: -1 for unlimited PRO), and billing period end
- `POST /api/subscription/checkout` - Create Stripe checkout session, return redirect URL
- `POST /api/subscription/portal` - Create Stripe billing portal session, return redirect URL
- `POST /api/webhooks/stripe` - Stripe webhook endpoint (handles subscription.updated, invoice.payment_succeeded, etc.)

### RAG Service (port 8000)
- `POST /generate` - AI meal plan generation (requires X-RAG-SECRET header)
- `POST /embed/backfill/*` - Populate vector embeddings
- `GET /health` - Health check

## Frontend Theme & Design System

### Design System
- **No third-party UI library** (no shadcn, Radix, Headless UI). Custom components only.
- **Icons**: `@heroicons/react` v2 — 24px outline style
- **Class composition**: `cn()` from `lib/cn.ts` (clsx + tailwind-merge). Always use `cn()` for conditional classes.

### Color Tokens (Tailwind v4 CSS variables in `app/globals.css`)
```
Brand green (primary):  brand-50 … brand-900
  Main CTA:             bg-brand-600  hover:bg-brand-700
  Text/link:            text-brand-600  hover:text-brand-700
  Success badge:        bg-brand-100 text-brand-700

Accent amber (highlight): accent-50 … accent-600
  Warning badge:        bg-accent-100 text-accent-600

Surface (subtle backgrounds): surface-50, surface-100, surface-200

Semantic (Tailwind defaults):
  Error/destructive:    red-600 / red-700 / bg-red-50 / bg-red-100
  Info:                 blue-500 / blue-600 / bg-blue-100
  Neutral:              gray-50 … gray-900
```

### Typography
- **Body/UI**: `Geist` sans-serif (`--font-geist-sans`)
- **Monospace**: `Geist Mono` (`--font-geist-mono`)
- **Brand/Display headings**: `Playfair Display` 700 (`--font-brand`)
- Common sizes: `text-xs` (labels/badges) → `text-sm` (descriptions) → `text-base` (body) → `text-lg` (card titles) → `text-2xl` (page headers)
- Weights: `font-medium` (buttons/labels), `font-semibold` (titles), `font-bold` (h1)

### Component Patterns

**Button** (`components/ui/Button.tsx`)
- Variants: `primary` (bg-brand-600), `secondary` (bg-white border-gray-300), `destructive` (bg-red-600), `ghost` (transparent)
- Sizes: `sm` (px-3 py-1.5 text-xs), `md` (px-4 py-2 text-sm, default), `lg` (px-6 py-3 text-base)
- Always: `rounded-md border font-medium transition focus:ring-2 focus:ring-offset-2 disabled:opacity-50`

**Card** (`components/ui/Card.tsx`)
- Root: `bg-white rounded-xl border border-gray-200 shadow-sm`
- Title: `text-lg font-semibold text-gray-900`
- Description: `text-sm text-gray-500 mt-1`

**Badge** (`components/ui/Badge.tsx`)
- Base: `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`
- Variants: `default` (gray-100/700), `success` (brand-100/700), `warning` (accent-100/600), `info` (blue-100/700), `destructive` (red-100/700)

**Modal** (`components/Modal.tsx`)
- Backdrop: `fixed inset-0 z-50 flex items-center justify-center bg-black/50`
- Dialog: `max-w-{sm|md|lg} w-full mx-4 bg-white rounded-xl shadow-xl`
- Header: `px-6 py-4 border-b border-gray-200`
- Content: `px-6 py-4`
- Supports escape key + backdrop click to close

**Toast** (`components/ui/Toast.tsx`)
- Position: `fixed bottom-4 right-4 z-50`
- Variants: `success` (border-l-brand-500), `error` (border-l-red-500), `info` (border-l-blue-500)
- Auto-dismiss: 4 seconds; animation: `animate-slide-up`
- Usage: `const { showToast } = useToast()` → `showToast('message', 'success')`

### Animations (`app/globals.css`)
- `animate-fade-in` — modal open (0.2s ease-out)
- `animate-slide-up` — toast appear (0.25s ease-out, translateY 8px → 0)
- `animate-pulse` / `animate-spin` — skeleton / button loading spinner

### Conventions
- Light mode only (no dark mode)
- Form labels: `text-sm font-medium text-gray-700 mb-1`
- Form errors: `text-xs text-red-600` below field
- Helper text: `text-xs text-gray-500`
- Links: `text-sm font-medium text-brand-600 hover:text-brand-700 transition`
- Page container: `max-w-4xl mx-auto py-8 px-4`
- Section spacing: `space-y-6`
