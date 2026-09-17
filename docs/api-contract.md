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
`assistant_text`, `generation_status`, `complete`, `mealplan_saved`, and `error`
SSE events.

`POST /api/mealplans/generate-ai` accepts the query parameter `servings`. It is
an integer from 1 through 12 and defaults to `1` when omitted. `servings` is
part of the durable request fingerprint and is forwarded to RAG. Reusing an idempotency key with a
different serving count returns the existing idempotency-conflict response.

New agent-generated plans store portions for the request's serving count. Every dish item contains both
the nutrition-oriented `servingsUsed` value and a physical `amountUsed` value:

```json
{
  "id": 123,
  "name": "Organic Spaghetti",
  "servingsUsed": 1.5,
  "amountUsed": { "value": 170, "unit": "g" }
}
```

`amountUsed.unit` is one of `g`, `ml`, or `count`; its value is greater than
zero and no greater than `10,000 × servings` per dish item. `servingsUsed` is
similarly bounded at `20 × servings`. Existing plans without `amountUsed`, and
generation clients that omit `servings`, remain valid as one-person plans.

`GET /api/mealplans/{id}/shopping-list` returns `qty` as the number of packages
to buy. Each item also includes nullable `neededAmount` and `neededUnit` fields
and a `quantityEstimated` boolean. The service calculates exact package counts
when the physical amount and package size have compatible units. It otherwise
uses legacy serving metadata when available, or returns one package with
`quantityEstimated: true` when it cannot calculate a reliable quantity.

The browser accepts UTF-8 SSE frames terminated by an empty CRLF, LF, or CR
line. It ignores comment-only frames, joins repeated `data` fields with a
newline, and requires each dispatched event's data to be valid JSON. An
undispatched frame is limited to 1 MiB (1,048,576 UTF-8 bytes), including
non-empty-line terminators and excluding the terminating empty line. Malformed,
oversized, or truncated frames fail the generation stream and release its
reader; aborts stop dispatch before any later buffered event.

## RAG

| Method and path | Purpose |
|---|---|
| `GET /health` | Process liveness |
| `GET /ready` | Authenticated database readiness |
| `POST /generate` | Internal SSE agent generation |
| `POST /embed/backfill/items` | Backfill item embeddings |
| `POST /embed/backfill/nutrition` | Backfill nutrition embeddings |
| `POST /embed/backfill/ingredients` | Backfill ingredient embeddings |

`POST /generate` accepts `servings` as an optional integer from 1 through 12,
defaulting to `1`. Generated meals, `servingsUsed`, and physical `amountUsed`
values represent the requested total serving count; downstream shopping
calculation does not multiply them again.
