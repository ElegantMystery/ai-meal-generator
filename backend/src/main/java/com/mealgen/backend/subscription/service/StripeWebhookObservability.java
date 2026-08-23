package com.mealgen.backend.subscription.service;

import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

import java.util.Set;

@Component
@Slf4j
@RequiredArgsConstructor
public class StripeWebhookObservability {
    public static final String METRIC = "mealgen.stripe.webhook.events";
    private static final Set<String> KNOWN_TYPES = Set.of(
            "checkout.session.completed", "customer.subscription.updated",
            "customer.subscription.deleted", "invoice.payment_succeeded");
    private final MeterRegistry registry;

    public void record(String outcome, String eventType) {
        String type = KNOWN_TYPES.contains(eventType) ? eventType : "other";
        registry.counter(METRIC, "outcome", outcome, "type", type).increment();
        MDC.put("event", "STRIPE_WEBHOOK_" + outcome.toUpperCase());
        MDC.put("webhookType", type);
        try {
            log.info("Stripe webhook outcome={} type={}", outcome, type);
        } finally {
            MDC.remove("event");
            MDC.remove("webhookType");
        }
    }
}
