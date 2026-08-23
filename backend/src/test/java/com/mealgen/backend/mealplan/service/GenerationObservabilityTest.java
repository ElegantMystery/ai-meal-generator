package com.mealgen.backend.mealplan.service;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GenerationObservabilityTest {
    @Test
    void recordsLifecycleCountersAndDurations() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        GenerationObservability observability = new GenerationObservability(registry);

        var success = observability.started("00000000-0000-4000-8000-000000000001");
        observability.succeeded(success, "00000000-0000-4000-8000-000000000001");
        var failure = observability.started("00000000-0000-4000-8000-000000000002");
        observability.failed(failure, "00000000-0000-4000-8000-000000000002", "GENERATION_TIMEOUT");
        observability.quotaRejected("00000000-0000-4000-8000-000000000003");
        observability.providerTokens(120, 45);

        assertThat(registry.get(GenerationObservability.EVENTS).tag("outcome", "started").counter().count()).isEqualTo(2);
        assertThat(registry.get(GenerationObservability.EVENTS).tag("outcome", "succeeded").counter().count()).isEqualTo(1);
        assertThat(registry.get(GenerationObservability.EVENTS).tag("outcome", "failed").counter().count()).isEqualTo(1);
        assertThat(registry.get(GenerationObservability.DURATION).timers()).hasSize(2);
        assertThat(registry.get(GenerationObservability.TOKENS).tag("direction", "input").counter().count()).isEqualTo(120);
    }
}
