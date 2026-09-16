# Repository agent guide

This is the authoritative instruction file for coding agents. `CLAUDE.md` only
points here so the two tools cannot drift.

## Project

AI Meal Generator has three services: Next.js 16/React 19 (`frontend`), Spring
Boot 4/Java 21 (`backend`), and FastAPI/Python 3.11 (`rag`). PostgreSQL 18 with
pgvector stores application, recipe, and embedding data.

AI generation is an SSE tool-use loop served by MiniMax-M3 through its
Anthropic-compatible API. OpenAI is used only for embedding backfills. See
`docs/architecture.md` and `docs/api-contract.md`.

Authentication is Google OAuth2 only. Mutating browser requests use session
cookies plus CSRF protection. FREE users receive three successful generations per
UTC calendar month; quota exhaustion is HTTP 429 with `QUOTA_EXCEEDED`.

## Required workflow

For tasks that change repository files:

1. Pull `main` and create `feat/<name>`; never implement directly on `main`.
2. Write or update tests before implementation when behavior changes.
3. Run the service checks listed in `docs/development.md`.
4. Review correctness, security, and performance; fix critical/high findings.
5. Push and open a PR only when checks pass. Merge through the PR.

Use the project-level `.venv` for Python. Install hash-locked dependencies with
`--require-hashes`; see `docs/python-dependencies.md`. New Flyway migrations must
be applied before integration testing.

## Agent roles and PR ownership

The user identifies each session as either the coordinator/reviewer (the
"Scrum Master" session) or a developer. This shared guide does not grant a
session merge authority merely because it has read the file.

- **Coordinator/reviewer:** Prioritize work, create comprehensive GitHub Issues
  with clear acceptance criteria, and assign new issues to the user by default.
  Validate each PR against its issue, CI, correctness, security, and performance.
  Leave actionable PR comments when validation fails and re-review after changes.
  Decide merge order; merge passing PRs and close their issues. Do not merge a PR
  with failing checks or unresolved critical/high findings.
- **Developer:** Own implementation and tests for an assigned issue on a separate
  feature branch or worktree. Run the required checks, open a PR linked to the
  issue, and address review feedback. Do not merge the PR or close the issue.

When one PR merges before another, the developer of the remaining PR updates it
against current `main`, resolves Git conflicts, and reruns affected checks. The
coordinator decides the intended combined behavior when changes disagree; ask
the user before choosing if the product requirement is ambiguous. Avoid parallel
assignments that edit the same behavior without an agreed dependency or order.

## Engineering conventions

- Preserve the end-to-end SSE contract for `/api/mealplans/generate-ai`.
- Keep RAG routes fail-closed behind `X-RAG-SECRET` outside `/health`.
- Do not log emails, secrets, prompts, webhook bodies, or raw provider errors.
- Frontend components are custom Tailwind components; use Heroicons and `cn()`
  for conditional classes. The app is light-mode only.
- Preserve unrelated user changes in a dirty worktree.

## Focused documentation

- `README.md` — orientation and quick start
- `docs/architecture.md` — services and generation data flow
- `docs/api-contract.md` — endpoints, authentication, and quota errors
- `docs/development.md` — local setup and verification commands
- `docs/deployment-rollback.md` — production deploy and rollback
- `docs/production-operations.md` — production access, TLS, and runbook index
- `docs/observability-business-flows.md` — metrics, logs, and alerts
- `docs/security/csrf-threat-model.md` — browser security model
- `docs/stripe-webhook-operations.md` — billing operations
- `docs/python-dependencies.md` — locked Python dependency workflow
- `docs/data-pipelines.md` — grocery and recipe ingestion
- `docs/frontend-design-system.md` — UI tokens and component conventions

Run `bash scripts/check_documentation_drift.sh` after changing endpoints,
configuration, provider integration, auth, or verification commands.
