# AI Meal Generator

AI Meal Generator creates grocery-store-specific meal plans with a Next.js
frontend, Spring Boot API, and FastAPI agent service. MiniMax-M3 generates plans;
OpenAI is used only to backfill vector embeddings.

## Project status

The repository audit remediation program is complete. All work from AUD-001
through AUD-015 has been implemented, verified, merged, and deployed. The
[audit completion record](docs/project-audit-tasks.md) summarizes the outcomes
and retains the detailed acceptance evidence.

## Quick start

Prerequisites: Docker, Node.js 20, Java 21, and Python 3.11.

```bash
cp .env.example .env
docker compose up --build
```

Fill the database, Google OAuth, shared RAG secret, and MiniMax values in `.env`
before exercising authenticated AI generation. The services listen on frontend
`:3000`, backend `:8080`, RAG `:8000`, and PostgreSQL `:5432`.

## Verify changes

```bash
(cd backend && ./mvnw --batch-mode test)
(cd frontend && npm ci && npm test -- --runInBand && npm run lint && npm run build)
python3.11 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r rag/requirements-test.txt
RAG_ENV=test RAG_SHARED_SECRET=test-secret OPENAI_API_KEY=test-key \
  MINIMAX_API_KEY=test-key .venv/bin/python -m pytest rag/tests -q
bash scripts/check_documentation_drift.sh
```

Start with [development setup](docs/development.md), then see the
[architecture](docs/architecture.md), [API contract](docs/api-contract.md), and
[repository agent guide](AGENTS.md). Production procedures live in focused
runbooks under `docs/`.
