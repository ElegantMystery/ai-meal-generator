# Development

## Setup

Prerequisites are Docker, Node.js 20, Java 21, Python 3.11, and ripgrep (`rg`).
On Ubuntu, install ripgrep with `sudo apt-get install ripgrep`; CI installs it
before running the documentation checks.

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
(cd frontend && npm ci && npm test -- --runInBand && npm run lint && \
  NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 npm run build)
RAG_ENV=test RAG_SHARED_SECRET=test-secret OPENAI_API_KEY=test-key \
  MINIMAX_API_KEY=test-key .venv/bin/python -m pytest rag/tests -q
.venv/bin/pip-audit -r rag/requirements.txt
(cd rag && ../.venv/bin/pip-compile --generate-hashes --strip-extras \
  --resolver=backtracking --output-file=requirements.txt requirements.in && \
  ../.venv/bin/pip-compile --allow-unsafe --generate-hashes --strip-extras \
  --resolver=backtracking --output-file=requirements-test.txt requirements-test.in)
git diff --exit-code -- rag/requirements.txt rag/requirements-test.txt
bash scripts/check_rag_image_reproducibility.sh
bash scripts/deploy/test_deploy_prod.sh
.venv/bin/python scripts/test_pr_ci_workflow.py
bash scripts/check_immutable_ci_refs.sh
.venv/bin/python scripts/test_documentation_drift.py
bash scripts/check_documentation_drift.sh
```

Validate Flyway against an empty PostgreSQL 18 database with pgvector before
submitting a migration. With the development database running and empty, use:

```bash
(cd backend && DB_PASSWORD=dev-password ./mvnw --batch-mode flyway:migrate)
(cd backend && DB_PASSWORD=dev-password ./mvnw --batch-mode flyway:validate)
```

## Pull-request CI

Every pull request targeting `main`, including Dependabot pull requests, runs
`.github/workflows/ci.yml`. New commits cancel older runs for the same pull
request. The workflow has read-only repository access, uses test-only values,
and does not receive production secrets, push images, or deploy code.

The stable status-check names are:

- `Repository Policy & Documentation`
- `Backend Tests`
- `Flyway Fresh-Database Validation`
- `Frontend Tests, Lint & Build`
- `RAG Tests & Dependency Integrity`

After these checks have completed successfully once, a repository owner must
open **Settings → Rules → Rulesets**, create or update the branch ruleset for
`main`, and enable **Require a pull request before merging** plus all five status
checks above. Enable **Require branches to be up to date before merging**. Leave
the bypass list empty unless a named administrator or automation app is approved
to push directly; add only those actors with **Always allow** bypass. The
production workflow remains a separate post-merge workflow triggered by pushes
to `main`.

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
