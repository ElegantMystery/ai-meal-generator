# Business-flow observability

AI generation records bounded Micrometer counters for started, succeeded,
failed, and quota-rejected outcomes plus success/failure duration timers. The
browser creates `X-Correlation-ID`; the backend validates it as a UUID and sends
it to RAG, RAG logs it without prompt content, and the saved plan stores it at
`planJson._meta.correlationId`. Durable generation request IDs remain available
for idempotent status recovery.

Stripe webhook counters cover received, processed, retried (duplicate delivery),
and failed outcomes. Event types are limited to known values with `other` as a
fallback to prevent unbounded metric dimensions.

CloudWatch derives failure/success counters from structured MDC events and
alarms on sustained generation failures or any signed webhook processing
failure. Correlation IDs are searchable log fields, not metric dimensions.

## Sensitive-log policy

- Never log generation briefs, preferences, prompts, model text, tool results,
  webhook payloads/signatures, credentials, email addresses, or upstream bodies.
- Log stable public error codes and exception class names instead of external
  exception messages and stacks.
- User IDs, durable request IDs, Stripe event IDs, and correlation UUIDs are
  permitted operational identifiers.
