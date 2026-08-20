package com.mealgen.backend.subscription.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Durable idempotency ledger for Stripe deliveries. Rows are claimed and marked
 * processed in the same transaction as the corresponding subscription mutation.
 */
@Entity
@Table(name = "stripe_webhook_events")
@Getter
@NoArgsConstructor
public class StripeWebhookEvent {

    @Id
    @Column(name = "event_id", nullable = false, updatable = false)
    private String eventId;

    @Column(name = "event_type", nullable = false, updatable = false)
    private String eventType;

    @Column(name = "stripe_created_at", updatable = false)
    private Instant stripeCreatedAt;

    @Column(name = "received_at", nullable = false, updatable = false)
    private Instant receivedAt;

    @Column(name = "processed_at")
    private Instant processedAt;
}
