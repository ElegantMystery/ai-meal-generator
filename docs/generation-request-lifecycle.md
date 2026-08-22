# Generation Request Lifecycle

AI meal-plan generation is represented by a durable `generation_requests` row.
The row is the source of truth when an SSE connection is interrupted, retried,
or lost during a backend restart.

## Request contract

Clients send a nonblank `Idempotency-Key` header of at most 255 characters to
`POST /api/mealplans/generate-ai`. A key belongs to one authenticated user and
one request payload. Reusing it with changed store, days, or preferences returns
HTTP 409. Concurrent submissions with the same user and key create one request;
only the insert winner reserves quota and calls RAG.

```text
                         reserve quota + mark RUNNING
POST + new key ──► PENDING ─────────────────────────► RUNNING
                       │                                 │
                       │ quota rejection/start failure   ├── saved atomically ──► SUCCEEDED
                       ▼                                 │
                     FAILED ◄── error/cancel/timeout ────┤
                                                         │
                                                         └── stale cleanup ─────► ABANDONED
```

Quota reservation and `RUNNING` are committed in one transaction. Failure and
FREE-tier quota release are also one transaction. Saving the meal plan and
transitioning to `SUCCEEDED` share a transaction, so neither can exist without
the other. Terminal transitions use conditional updates; duplicate terminal
events are no-ops.

## Recovery API

Both endpoints require the normal authenticated browser session and enforce
request ownership:

- `GET /api/mealplans/generation-requests/{requestId}`
- `GET /api/mealplans/generation-requests?idempotencyKey={key}`

The response contains the request ID, status, safe failure code, saved meal-plan
ID, and timestamps. The dashboard stores active recovery metadata in
`localStorage`, polls after a lost connection or refresh, and fetches the saved
meal plan once the request succeeds.

## Cleanup and retention

The backend checks hourly by default. `PENDING` or `RUNNING` requests with no
update for 30 minutes become `ABANDONED`; any recorded FREE-tier reservation is
released in the same transaction. Terminal request records are retained for 30
days, then deleted without deleting their saved meal plans.

The durations are configurable:

| Property | Default | Purpose |
|---|---:|---|
| `mealgen.generation.stale-after` | `PT30M` | Maximum inactive request age |
| `mealgen.generation.cleanup-interval` | `PT1H` | Delay between cleanup runs |
| `mealgen.generation.retention` | `PT720H` | Terminal-record retention |

If legitimate generations approach the stale threshold, increase
`stale-after` before increasing the model turn or timeout limits. At higher
volume, replace the single 100-row cleanup batch with repeated bounded batches
or a dedicated worker.
