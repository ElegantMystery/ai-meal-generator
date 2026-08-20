# Stripe Webhook Operations

Stripe deliveries are signature-verified and recorded in
`stripe_webhook_events`. The event claim, subscription mutation, and
`processed_at` update share one database transaction.

## Expected delivery behavior

- A successful or duplicate event returns HTTP 200.
- A malformed signature returns HTTP 400 and must not be replayed unchanged.
- A processing, Stripe API, or database failure returns HTTP 5xx. The transaction
  rolls back, including its event claim, so Stripe can retry the same event ID.
- An event with a row containing `processed_at` is a completed delivery. Duplicate
  delivery is a successful no-op.
- An unhandled event type is recorded as processed but does not mutate a
  subscription.

## Diagnose a delivery

Use CloudWatch backend logs to find the Stripe event ID, then query production
PostgreSQL through the approved SSM/RDS access path:

```sql
SELECT event_id, event_type, stripe_created_at, received_at, processed_at
FROM stripe_webhook_events
WHERE event_id = 'evt_REPLACE_ME';
```

Interpretation:

- No row after an HTTP 5xx: processing rolled back as intended and is retryable.
- A populated `processed_at`: processing committed; replay is harmless.
- A null `processed_at`: an abnormal partial state. The normal transaction should
  never commit this state; investigate manual database changes or a migration
  incident before replaying.

Also inspect the current entitlement:

```sql
SELECT u.id, u.stripe_customer_id,
       s.stripe_subscription_id, s.status, s.current_period_end
FROM users u
LEFT JOIN subscriptions s ON s.user_id = u.id
WHERE u.stripe_customer_id = 'cus_REPLACE_ME';
```

Do not include customer email addresses, webhook payloads, API keys, or webhook
signing secrets in tickets or chat.

## Replay a failed event

1. Correct the underlying database, configuration, or Stripe connectivity issue.
2. Confirm the event has no completed ledger row using the query above.
3. In Stripe's webhook delivery view, select the original event and resend it to
   the production webhook endpoint.
4. Confirm Stripe receives HTTP 200.
5. Confirm `processed_at` is populated and the `subscriptions` row matches the
   current Stripe subscription.
6. Confirm `/api/subscription/status` reports the expected tier for the user.

Never insert or delete a ledger row merely to silence a delivery. If a completed
event must be intentionally reprocessed, first capture the event and entitlement
state, obtain approval for the database mutation, and document why ordinary
current-state reconciliation is insufficient.

## Recovery cases

### `customer.subscription.updated` arrives before checkout completion

The handler retrieves current subscription state from Stripe and upserts by the
customer ID already stored when Checkout was created. No manual ordering fix is
required.

### An old deletion arrives after a replacement subscription

Deletion is applied only when its subscription ID matches a stored row. A stale
event for an older subscription cannot cancel the replacement subscription.

### Repeated 5xx for a missing customer

Verify `users.stripe_customer_id` matches the event's customer. Do not fabricate a
mapping without confirming the customer belongs to that user. Repair the verified
mapping, then replay the original event.
