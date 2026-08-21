package com.mealgen.backend.subscription.repository;

import com.mealgen.backend.subscription.model.StripeWebhookEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;

public interface StripeWebhookEventRepository
        extends JpaRepository<StripeWebhookEvent, String> {

    /**
     * Claims an event without an exists-then-insert race. Concurrent deliveries
     * serialize on the primary key; exactly one transaction receives 1.
     */
    @Modifying
    @Query(value = """
            INSERT INTO stripe_webhook_events
                (event_id, event_type, stripe_created_at, received_at)
            VALUES (:eventId, :eventType, :stripeCreatedAt, CURRENT_TIMESTAMP)
            ON CONFLICT (event_id) DO NOTHING
            """, nativeQuery = true)
    int claim(
            @Param("eventId") String eventId,
            @Param("eventType") String eventType,
            @Param("stripeCreatedAt") Instant stripeCreatedAt
    );

    @Modifying
    @Query(value = """
            UPDATE stripe_webhook_events
               SET processed_at = CURRENT_TIMESTAMP
             WHERE event_id = :eventId
            """, nativeQuery = true)
    int markProcessed(@Param("eventId") String eventId);
}
