# Development

## Setup

Prerequisites are Docker, Node.js 20, Java 21, and Python 3.11.

```bash
cp .env.example .env
python3.11 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r rag/requirements-test.txt
(cd frontend && npm ci)
docker compose up --build
```

`.env.example` documents local configuration. `MINIMAX_API_KEY` drives agentic
generation. `OPENAI_API_KEY` is required only for embedding backfills. Google
OAuth2 is the only user authentication method.

## Run services separately

```bash
(cd backend && ./mvnw spring-boot:run)
(cd frontend && npm run dev)
RAG_ENV=development RAG_SHARED_SECRET=dev-secret \
  .venv/bin/uvicorn --app-dir rag app.main:app --host 0.0.0.0 --port 8000
```

New Flyway migrations belong in `backend/src/main/resources/db/migration` and must
be applied before integration testing. Docker Compose applies them at backend
startup.

## Required checks

```bash
(cd backend && ./mvnw --batch-mode test)
(cd frontend && npm test -- --runInBand && npm run lint && npm run build)
RAG_ENV=test RAG_SHARED_SECRET=test-secret OPENAI_API_KEY=test-key \
  MINIMAX_API_KEY=test-key .venv/bin/python -m pytest rag/tests -q
bash scripts/check_immutable_ci_refs.sh
bash scripts/check_documentation_drift.sh
```

For Python dependency updates, use the lock procedure in
`python-dependencies.md`. To smoke-test the generation provider with real
credentials, run `python rag/scripts/smoke_minimax_agent.py` from the activated
project virtual environment.

## Production links

- Deploy/rollback: `deployment-rollback.md`
- Logs, metrics, and alerts: `observability-business-flows.md`
- Billing webhooks: `stripe-webhook-operations.md`
- CSRF/browser security: `security/csrf-threat-model.md`
- Flyway repair: `flyway-production-reconciliation.md`
- Production access/TLS index: `production-operations.md`
- Grocery and recipe ingestion: `data-pipelines.md`
