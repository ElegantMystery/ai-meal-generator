# AUD-015 Application Plumbing Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development to implement the independent service tasks, then review the integrated branch.

**Goal:** Complete the six AUD-015 checklist items with regression coverage.

**Architecture:** Keep existing HTTP, SSE, quota, and persistence interfaces. Share backend JSON/principal handling, harden the browser stream reader, and make RAG validation failures distinguishable from infrastructure failures.

**Tech Stack:** Spring Boot 4 / Java 21, Next.js / TypeScript, FastAPI / Python 3.11.

**Spec:** `docs/project-audit-tasks.md`, AUD-015, and the existing contracts in `docs/api-contract.md`.

## Global constraints

- Preserve `/api/mealplans/generate-ai` event names and payloads, cookie/CSRF authentication, successful-generation quota accounting, and Stripe retry/idempotency behavior.
- Preserve the Jackson 2 JSON-node interfaces currently used by persistence; expose a single Spring-managed compatibility mapper instead of per-service instances. Do not migrate the HTTP serialization stack in this task.
- Never log emails, secrets, prompts, provider bodies, or raw provider exceptions.
- No dependency updates, schema changes, or production-memory interventions.
- Work on `feat/aud15-application-plumbing`; service workers own disjoint files and do not commit or change branches. The coordinating agent integrates, reviews, and commits the final result.

## Task 1: Backend JSON, principal extraction, and typed failures

Files: backend JSON configuration; a shared security principal helper; mealplan/preferences/subscription controllers; mealplan and subscription services; associated backend tests.

- [ ] Write regressions that show injected JSON configuration is honored, Google principal extraction rejects missing/anonymous/invalid principals, and malformed JSON versus database/provider errors retains safe classification.
- [ ] Run those tests and record the expected failure before implementation.
- [ ] Provide one Spring-managed Jackson 2 mapper and inject it in all four current construction sites, including Stripe payload parsing. Centralize the three duplicated email extraction methods while retaining authenticated string principals used by existing controller tests; reject anonymous tokens explicitly.
- [ ] Narrow JSON/date/Stripe/session-specific catches to their declared exception types. Retain explicitly documented catch-all boundaries only where they are needed to terminate SSE safely or sanitize public errors. Do not attach raw JSON exception objects to logs.
- [ ] Run backend tests, including existing quota, webhook, security, and PostgreSQL integration tests.

## Task 2: Browser SSE reader

Files: `frontend/lib/sse.ts`, an extracted parser module if useful, and `frontend/__tests__/lib/sse.test.ts`.

- [ ] Add tests using actual ReadableStreams for split CRLF/LF/CR delimiters, comments, multiline data, split UTF-8, callback failures, abort, malformed JSON, oversized frames, and truncated EOF.
- [ ] Reproduce missing CRLF handling and missing cleanup before implementation.
- [ ] Implement incremental bounded parsing with a documented 1 MiB per-frame limit, dispatch complete frames only, and reject malformed application JSON/incomplete data with fixed safe errors. Keep existing POST/CSRF/idempotency/correlation headers and event shapes.
- [ ] Always cancel unfinished streams and release the reader lock on abort or failure; preserve the original exception if cleanup fails. Confirm comment-only frames do not dispatch events.
- [ ] Run frontend tests, lint, and production build.

## Task 3: RAG authentication verification, error boundaries, dead settings

Files: `rag/app/agent/tools.py`, `rag/app/validators.py`, relevant RAG tests, `rag/app/config.py`; other RAG error boundaries only when evidence requires changes.

- [ ] Add regression tests showing invalid plans are repairable but database failures and unexpected programming errors escape to the existing sanitized generation boundary.
- [ ] Narrow `_submit_plan` validation catches to expected public validation exceptions and JSON/schema decoding errors at their source. Preserve final generation-stream sanitization and cancellation behavior.
- [ ] Verify both protected routers use shared `require_rag_secret`; run tests covering each route, missing/incorrect secret, and production startup. Avoid duplicating the existing implementation.
- [ ] Search the repository and deployment configuration for consumers of `CHAT_MODEL` and other candidate unused settings; remove only settings with no consumers. Record the search scope and any limits on external-consumer verification.
- [ ] Run the complete RAG suite using the project `.venv`.

## Integration and completion

- [ ] Review each service diff for the task requirements and correctness/security/performance; fix blocking findings.
- [ ] Update the AUD-015 checklist with implementation/test evidence, document SSE failure/size semantics, and reconcile configuration documentation where needed.
- [ ] Run the required commands from `docs/development.md`, including documentation regression/drift and immutable CI reference checks.
- [ ] Obtain an independent whole-branch review, fix critical/high findings, commit, push, and create a PR with concrete validation evidence.
