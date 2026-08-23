# Architecture

## Services

```text
Browser :3000 ──► Spring Boot :8080 ──► FastAPI RAG :8000
                        │                       │
                        └──────── PostgreSQL + pgvector :5432
```

The frontend owns presentation and SSE parsing. The backend owns Google OAuth2,
CSRF/session security, quota reservation, billing, persistence, and the public API.
The RAG service owns grocery retrieval and the agent loop; it is reachable from the
backend with `X-RAG-SECRET`, not directly from browsers.

## AI generation

`POST /api/mealplans/generate-ai` requires an idempotency key and streams SSE from
browser to backend to RAG. Before opening the upstream stream, the backend reserves
one of a FREE user's three monthly generations. Quota exhaustion returns HTTP 429
with `{"error":"QUOTA_EXCEEDED"}`. PRO reservations are unlimited.

The cold-start agent discovers products with `list_categories`, `search_items`,
`get_item_details`, and `list_recipes`; validates IDs; and terminates with
`submit_plan`. MiniMax-M3 is the generation provider through its
Anthropic-compatible endpoint. The Anthropic SDK is only the protocol client.
OpenAI is not on the generation path and is used only by embedding backfills.

Progress is emitted as `phase`, `tool_call`, `tool_result`, and `assistant_text`
events. The RAG service emits `complete`; after atomic persistence the backend emits
`mealplan_saved`. Terminal failures emit `error` and release a consumed FREE quota
reservation. See `generation-request-lifecycle.md` for idempotency and recovery.

Generated plan `_meta` records `generatedBy`, `agentModel`, `turnsUsed`, and
`toolCallCount`. Recipes are discovered on demand; no recipe-template list is
persisted in `_meta`.

## Provider-specific normalization

MiniMax-M3 can serialize large tool calls as XML text and wrap arrays in
`{"item": ...}` objects. `rag/app/agent/runner.py` normalizes XML tool calls and
`rag/app/validators.py` unwraps array artifacts before Pydantic validation. The
agent uses a 16,384-token output budget with a bounded repair path.
