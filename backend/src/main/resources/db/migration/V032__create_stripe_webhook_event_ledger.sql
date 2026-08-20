CREATE TABLE stripe_webhook_events (
    event_id          VARCHAR(255) PRIMARY KEY,
    event_type        VARCHAR(255) NOT NULL,
    stripe_created_at TIMESTAMPTZ,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at      TIMESTAMPTZ
);

CREATE INDEX idx_stripe_webhook_events_received_at
    ON stripe_webhook_events (received_at);

CREATE INDEX idx_stripe_webhook_events_unprocessed
    ON stripe_webhook_events (received_at)
    WHERE processed_at IS NULL;
