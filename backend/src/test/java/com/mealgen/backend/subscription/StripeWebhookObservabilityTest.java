package com.mealgen.backend.subscription;

import com.mealgen.backend.subscription.service.StripeWebhookObservability;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class StripeWebhookObservabilityTest {
    @Test
    void recordsOutcomesAndBoundsUnknownEventTypes() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        StripeWebhookObservability observability = new StripeWebhookObservability(registry);

        observability.record("received", "customer.subscription.updated");
        observability.record("failed", "attacker.controlled.type");

        assertThat(registry.get(StripeWebhookObservability.METRIC)
                .tags("outcome", "received", "type", "customer.subscription.updated")
                .counter().count()).isEqualTo(1);
        assertThat(registry.get(StripeWebhookObservability.METRIC)
                .tags("outcome", "failed", "type", "other")
                .counter().count()).isEqualTo(1);
    }
}
