# AI Meal Generator

Full-stack meal planning application with a Next.js frontend, Spring Boot
backend, and FastAPI RAG service. See `AGENTS.md` for architecture, environment,
and operational details.

## Local quality checks

Prerequisites: Node.js 20, Java 21, and Python 3.11. Create the project virtual
environment and install test dependencies once:

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r rag/requirements-test.txt
```

Run the same service checks required before production images are published:

```bash
(cd backend && ./mvnw --batch-mode test)
(cd frontend && npm ci && npm test -- --runInBand && npm run lint && npm run build)
.venv/bin/python -m pytest rag/tests -q
```
