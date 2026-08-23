# Project Audit Backlog

This is the durable remediation backlog from the repository audit performed on
2026-08-19. It is intentionally stored in Git so work can resume without relying
on chat history.

## Working rules

- Address tasks in priority order unless a dependency requires otherwise.
- Use a separate `feat/...` branch for each implementation task.
- Follow red/green/refactor: add a failing regression test, implement the smallest
  correct change, then improve the design.
- Do not merge while relevant tests, lint, builds, or review checks are failing.
- Update this file in the same pull request: check completed acceptance criteria
  and add links to migrations, tests, operational notes, or follow-up issues.

## P0 — Billing and cost correctness

### AUD-001 — Implement a real monthly FREE-tier quota

Problem: `users.plans_generated_count` is a lifetime counter, although the product
promises three plans per month.

- [x] Choose and document the quota period boundary and timezone (UTC calendar month).
- [x] Replace the lifetime-only design with either a usage ledger or a counter plus
      an explicit period-start column.
- [x] Add a Flyway migration that preserves existing production data safely by
      assigning prior nonzero usage to the deployment month.
- [x] Reset usage lazily or transactionally when a new period begins; do not rely
      only on an external scheduler.
- [x] Make `/api/subscription/status` report usage for the current period.
- [x] Test period rollover, boundary timestamps, FREE users, and PRO users.

Acceptance criteria:

- A FREE user receives three successful generations in each defined month.
- Prior-month usage cannot block the current month.
- Concurrent requests cannot reset or corrupt the period.

Relevant code:

- `backend/src/main/java/com/mealgen/backend/subscription/service/SubscriptionService.java`
- `backend/src/main/java/com/mealgen/backend/auth/model/User.java`
- `backend/src/main/resources/db/migration/V028__create_subscriptions_table.sql`

### AUD-002 — Make quota reservation atomic

Problem: quota is checked before generation and incremented after completion, so
parallel requests can all pass the limit and incur model costs.

- [x] Define the in-process reservation contract for FREE and unlimited generations.
- [x] Reserve FREE-tier capacity with one conditional database operation or a
      correctly locked transaction.
- [x] Ensure both rule-based and AI generation use the same reservation mechanism.
- [x] Define cancellation and upstream-failure behavior without allowing unlimited
      retries or permanently consuming failed reservations.
- [x] Add a PostgreSQL-backed concurrency test that issues more requests than the
      remaining quota. Eight simultaneous reservations against two remaining
      slots now prove that PostgreSQL accepts exactly two and caps usage at three.
- [x] Add metrics/logging for reservation, completion, rejection, and release.
      `mealgen.generation.quota.events` uses bounded `outcome` and `tier` tags;
      structured lifecycle logs contain internal user IDs only. Transactional
      completions emit after commit, while rollbacks emit releases.

Acceptance criteria:

- At most the remaining FREE quota can be reserved under concurrent load.
- A rejected request does not call the RAG/model service.
- Usage accounting and saved meal plans cannot diverge silently.

Relevant code:

- `backend/src/main/java/com/mealgen/backend/mealplan/service/MealPlanService.java`
- `backend/src/main/java/com/mealgen/backend/mealplan/service/MealPlanGenerateService.java`
- `backend/src/main/java/com/mealgen/backend/mealplan/service/MealPlanPersistenceService.java`

### AUD-003 — Make Stripe webhook processing retryable and idempotent

Problem: service handlers swallow exceptions, after which the controller returns
HTTP 200 and Stripe will consider the failed delivery successful.

- [x] Stop swallowing retryable handler failures; return a non-2xx response.
- [x] Store processed Stripe event IDs behind a unique constraint.
- [x] Make duplicate delivery a successful no-op.
- [x] Avoid unnecessary Stripe retrieval where the signed event contains adequate
      data, or clearly handle retrieval failures as retryable.
- [x] Handle out-of-order subscription events deterministically.
- [x] Add PostgreSQL-backed transaction tests for concurrent duplicate delivery
      and replay after rollback. Eight simultaneous deliveries create one
      processed ledger row, and a failed handler rolls its claim back for retry.
- [x] Add an operator procedure for replaying failed events in
      `docs/stripe-webhook-operations.md`.

Acceptance criteria:

- A database or Stripe API failure produces a response Stripe will retry.
- Processing the same event more than once does not duplicate or corrupt state.
- A paid customer is not silently left on FREE after a handler exception.

Relevant code:

- `backend/src/main/java/com/mealgen/backend/subscription/controller/StripeWebhookController.java`
- `backend/src/main/java/com/mealgen/backend/subscription/service/SubscriptionService.java`

## P1 — Release safety and service security

### AUD-004 — Add mandatory CI quality gates before deployment

- [x] Add independent backend, frontend, and RAG test jobs.
- [x] Run frontend lint and production build.
- [x] Make deployment depend on every required quality job.
- [x] Remove `-DskipTests` from the release path or guarantee that an identical
      source revision passed tests before image publication.
- [x] Use immutable action/image/dependency versions where appropriate. GitHub
      Actions are pinned to full commit SHAs, third-party build/runtime images
      are pinned to multi-platform manifest digests, and CI rejects regressions.
- [x] Prevent direct production deployment when any matrix build or test fails.

Acceptance criteria:

- A deliberately failing test or lint rule prevents image deployment.
- CI reports each service failure separately and retains useful test output.

Relevant code:

- `.github/workflows/deploy.yml`
- `backend/Dockerfile`

Verification on 2026-08-20: the complete backend suite (including disposable
PostgreSQL 18/pgvector concurrency tests), frontend tests/lint/build, and RAG
suite all passed locally using the same commands as the independent CI jobs.

### AUD-005 — Restore the repository to a green test and lint baseline

Observed on 2026-08-19:

- Frontend Jest: 6 suites failed, 13 passed; 38 tests failed, 155 passed.
- Frontend ESLint: 3 errors and 2 warnings.
- Backend Maven: 62 tests errored because Mockito inline mock-maker agent
  attachment failed in the local Java 21 environment.
- Python pytest did not finish during the audit and was interrupted.
- `./mvnw` was not executable.

- [x] Ignore `.next`, coverage reports, and other generated artifacts in Jest and
      ESLint discovery.
- [x] Repair stale frontend assertions and required provider wrappers.
- [x] Configure Mockito for Java 21 without runtime self-attachment.
- [x] Commit the Maven wrapper executable bit; clean-checkout verification remains
      part of the final acceptance run.
- [x] Diagnose the Python suite stall and make mocked thread calls deterministic
      in the runner unit tests.
- [x] Record stable local and CI commands in the root README.

Verification on 2026-08-20: frontend 19 suites / 193 tests, ESLint, and the
Next.js production build passed; backend 89 tests passed; RAG 94 tests passed.

Acceptance criteria:

- `cd frontend && npm test -- --runInBand`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd backend && ./mvnw test`
- `source .venv/bin/activate && pytest -q`

All commands above complete successfully from a clean checkout with documented
prerequisites.

### AUD-006 — Make RAG authentication fail closed

- [x] Fail application startup outside an explicit test/dev mode when
      `RAG_SHARED_SECRET` is absent or blank.
- [x] Use constant-time secret comparison.
- [x] Apply one shared authentication dependency to generation and embedding
      routes instead of duplicating checks.
- [x] Add unauthorized, missing-secret, valid-secret, and startup-config tests.
- [x] Ensure Docker Compose and deployment validation require the secret.

Implemented on 2026-08-20 with production-default `RAG_ENV`, lifespan validation,
router-level `require_rag_secret`, constant-time comparison, required Compose
interpolation, and an explicit pre-deploy secret check. The RAG suite passes 94
tests.

Acceptance criteria:

- No production RAG endpoint becomes public because of a missing environment
  variable.

Relevant code:

- `rag/app/config.py`
- `rag/app/routes/generate_routes.py`
- `rag/app/routes/embed_routes.py`

### AUD-007 — Restore Flyway migration validation

- [x] Audit production schema history and explain why checksums were set to zero.
- [x] Back up schema history before any repair operation.
- [x] Reconcile the production history with immutable migration files.
- [x] Re-enable `validate-on-migrate` in production.
- [x] Add CI validation against a disposable PostgreSQL/pgvector database.

Acceptance criteria:

- Production startup rejects altered or inconsistent migrations.
- A fresh database can migrate from V1 to the latest version successfully.

Relevant code:

- `backend/src/main/resources/application-prod.yaml`
- `backend/src/main/resources/db/migration/`

### AUD-008 — Sanitize public generation errors

- [ ] Define stable public error codes and user-safe messages.
- [ ] Keep provider/SDK exception text only in structured server logs.
- [ ] Include a request/correlation ID in logs and safe client errors.
- [ ] Test Anthropic API, database, validation, timeout, and unexpected failures.

Relevant code:

- `rag/app/routes/generate_routes.py`
- `rag/app/agent/runner.py`
- `backend/src/main/java/com/mealgen/backend/mealplan/service/MealPlanService.java`

## P2 — Generation reliability and operability

### AUD-009 — Add durable, idempotent generation tracking

- [ ] Introduce a generation-request record with owner, idempotency key, status,
      quota reservation, timestamps, failure code, and saved meal-plan ID.
- [ ] Define state transitions and enforce them transactionally.
- [ ] Allow clients to recover status after disconnection or refresh.
- [ ] Prevent duplicate persistence after retry/reconnect.
- [ ] Add cleanup/retention rules for abandoned generation requests.
- [ ] Test browser cancellation, proxy timeout, backend restart, duplicate submit,
      duplicate terminal event, and recovery polling.

Acceptance criteria:

- Disconnecting the SSE client does not make usage or persistence unknowable.
- Retrying with the same idempotency key returns the same logical generation.

### AUD-010 — Strengthen production smoke tests and deployment rollback

- [ ] Check frontend, backend, RAG, database readiness, and SSE proxy behavior.
- [ ] Verify that the deployed revision/tag matches the intended Git SHA.
- [ ] Replace fixed deployment sleeps with bounded health polling.
- [ ] Define automatic rollback or a documented one-command rollback path.
- [ ] Test deployment failure after each service restart stage.

Relevant code:

- `.github/workflows/deploy.yml`
- `docker-compose.prod.yml`
- `nginx/nginx.conf`

### AUD-011 — Review cookie-session and CSRF protection

- [ ] Threat-model every state-changing cookie-authenticated endpoint.
- [ ] Re-enable Spring Security CSRF protection where applicable or document and
      test an equivalent origin/token defense.
- [ ] Keep the Stripe webhook outside browser CSRF protection while retaining
      signature verification.
- [ ] Verify production cookie Secure, HttpOnly, SameSite, domain, and lifetime
      behavior.
- [ ] Add cross-origin request tests.

Relevant code:

- `backend/src/main/java/com/mealgen/backend/security/SecurityConfig.java`
- `backend/src/main/resources/application-prod.yaml`

### AUD-012 — Improve observability for business-critical flows

- [ ] Add metrics for generation starts, successes, failures, durations, quota
      rejections, reservations, and upstream token/cost usage when available.
- [ ] Add Stripe webhook received/processed/retried/failed metrics by event type.
- [ ] Use one correlation ID across browser, backend, RAG, and saved plan metadata.
- [ ] Add alarms for sustained generation failure and webhook processing failure.
- [ ] Ensure logs do not expose emails, secrets, prompts containing sensitive user
      preferences, or raw provider errors.

## P3 — Maintainability and documentation

### AUD-013 — Pin and automate Python dependency updates

- [ ] Pin direct and transitive Python dependencies using a reproducible lock or
      constraints workflow.
- [ ] Add automated vulnerability and update checks.
- [ ] Verify deterministic RAG image builds.

Relevant code:

- `rag/requirements.txt`
- `rag/Dockerfile`

### AUD-014 — Reconcile project documentation with the implementation

- [ ] Correct 403 versus 429 quota documentation and choose one API contract.
- [ ] Describe MiniMax as the generation provider and OpenAI as embedding-only.
- [ ] Remove the obsolete `_meta.recipeTemplatesOffered` description.
- [ ] Remove stale local email/password authentication comments.
- [ ] Replace the stock frontend README with project-specific instructions.
- [ ] Decide whether `CLAUDE.md`, `AGENTS.md`, or both are authoritative; avoid
      maintaining conflicting copies.
- [ ] Shorten the root operational guide and link focused runbooks.
- [ ] Add a documentation-drift check for endpoints, environment variables, and
      verification commands where practical.

### AUD-015 — Reduce duplicated and fragile application plumbing

- [ ] Inject the configured Spring `ObjectMapper` instead of constructing isolated
      instances in services.
- [ ] Centralize authenticated-user/email extraction.
- [ ] Centralize RAG route authentication.
- [ ] Replace broad exception catches with typed failures at clear boundaries.
- [ ] Review handwritten SSE parsing for CRLF, comments, cancellation, maximum
      frame size, and malformed event behavior.
- [ ] Remove dead configuration such as unused chat-model settings after verifying
      there are no external consumers.

## Completion definition

This backlog is complete when every task is checked, each acceptance criterion has
automated or documented evidence, all service test/build/lint commands pass, the
production deployment is gated by those checks, and the billing/quota behavior
matches the published product contract under concurrency and failure.
