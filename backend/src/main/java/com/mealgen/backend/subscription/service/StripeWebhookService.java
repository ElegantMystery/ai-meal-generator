package com.mealgen.backend.subscription.service;

import com.mealgen.backend.subscription.repository.StripeWebhookEventRepository;
import com.stripe.model.Event;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Service
@Slf4j
@RequiredArgsConstructor
public class StripeWebhookService {

    private final StripeWebhookEventRepository eventRepository;
    private final SubscriptionService subscriptionService;
    private final StripeWebhookObservability observability;

    /**
     * Claims, applies, and records a signed Stripe event atomically. Any handler
     * failure rolls the claim back so Stripe can retry the same event ID.
     */
    @Transactional
    public void process(Event event) {
        String eventId = requireText(event.getId(), "Stripe event id is missing");
        String eventType = requireText(event.getType(), "Stripe event type is missing");
        Instant stripeCreatedAt = event.getCreated() == null
                ? null
                : Instant.ofEpochSecond(event.getCreated());
        observability.record("received", eventType);

        if (eventRepository.claim(eventId, eventType, stripeCreatedAt) == 0) {
            observability.record("retried", eventType);
            log.info("Ignoring duplicate Stripe event id={} type={}", eventId, eventType);
            return;
        }

        try {
            switch (eventType) {
                case "checkout.session.completed" ->
                        subscriptionService.handleCheckoutCompleted(event);
                case "customer.subscription.updated" ->
                        subscriptionService.handleSubscriptionUpdated(event);
                case "customer.subscription.deleted" ->
                        subscriptionService.handleSubscriptionDeleted(event);
                default -> log.debug("Recording unhandled Stripe event id={} type={}", eventId, eventType);
            }
            if (eventRepository.markProcessed(eventId) != 1) {
                throw new IllegalStateException(
                        "Stripe event claim disappeared before completion: " + eventId);
            }
            observability.record("processed", eventType);
        } catch (RuntimeException error) {
            observability.record("failed", eventType);
            throw error;
        }
    }

    private static String requireText(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value;
    }
}
