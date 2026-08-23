# API contract

Browser endpoints use the Google OAuth2 session. Mutating browser requests require
the CSRF token returned by `GET /api/auth/csrf`. The RAG endpoints require
`X-RAG-SECRET`, except `GET /health`.

Quota exhaustion is consistently HTTP **429 Too Many Requests** with error code
`QUOTA_EXCEEDED`. HTTP 403 is reserved for authorization/CSRF failures.

## Backend

| Method and path | Purpose |
|---|---|
| `GET /api/auth/csrf` | Issue/read the browser CSRF token |
| `GET /api/auth/me` | Current user and subscription summary |
| `POST /api/auth/complete-onboarding` | Complete onboarding |
| `POST /api/auth/logout` | End the session |
| `GET /api/items` | List items |
| `GET /api/items/costco` | Legacy Costco-filtered items |
| `GET /api/items/traderjoes` | Trader Joe's items |
| `POST /api/items` | Create an item |
| `GET /api/mealplans` | List the user's plans |
| `POST /api/mealplans` | Create a plan |
| `GET /api/mealplans/{id}` | Get a plan |
| `DELETE /api/mealplans/{id}` | Delete a plan |
| `POST /api/mealplans/generate` | Rule-based generation |
| `POST /api/mealplans/generate-ai` | Agentic SSE generation |
| `GET /api/mealplans/generation-requests/{id}` | Generation status by request ID |
| `GET /api/mealplans/generation-requests` | Generation status by idempotency key |
| `GET /api/mealplans/{id}/shopping-list` | Build a shopping list |
| `GET /api/preferences/me` | Read preferences |
| `PUT /api/preferences/me` | Replace preferences |
| `GET /api/subscription/status` | Tier and remaining quota |
| `POST /api/subscription/checkout` | Create Stripe Checkout session |
| `POST /api/subscription/portal` | Create Stripe billing portal session |
| `POST /api/webhooks/stripe` | Receive signed Stripe webhooks |

Google login begins at `GET /oauth2/authorization/google`.

`POST /api/mealplans/generate-ai` requires `Idempotency-Key`, accepts optional
`X-Correlation-ID`, and emits `phase`, `tool_call`, `tool_result`,
`assistant_text`, `complete`, `mealplan_saved`, and `error` SSE events.

## RAG

| Method and path | Purpose |
|---|---|
| `GET /health` | Process liveness |
| `GET /ready` | Database and provider readiness |
| `POST /generate` | Internal SSE agent generation |
| `POST /embed/backfill/items` | Backfill item embeddings |
| `POST /embed/backfill/nutrition` | Backfill nutrition embeddings |
| `POST /embed/backfill/ingredients` | Backfill ingredient embeddings |
