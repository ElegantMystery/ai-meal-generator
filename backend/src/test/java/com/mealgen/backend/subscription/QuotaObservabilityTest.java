package com.mealgen.backend.subscription;

import com.mealgen.backend.subscription.service.QuotaObservability;
import com.mealgen.backend.subscription.service.QuotaReservation;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class QuotaObservabilityTest {

    private SimpleMeterRegistry registry;
    private QuotaObservability observability;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        observability = new QuotaObservability(registry);
    }

    @Test
    void recordsEachFreeQuotaLifecycleOutcome() {
        QuotaReservation reservation = QuotaReservation.free(LocalDate.of(2026, 8, 1));

        observability.reserved(1L, reservation);
        observability.completed(1L, reservation);
        observability.released(1L, reservation, "upstream_failure");
        observability.rejected(1L);

        assertCount("reserved", "free", 1);
        assertCount("completed", "free", 1);
        assertCount("released", "free", 1);
        assertCount("rejected", "free", 1);
    }

    @Test
    void recordsUnlimitedReservationsWithoutFreeQuotaDimensions() {
        QuotaReservation reservation = QuotaReservation.unlimited();

        observability.reserved(2L, reservation);
        observability.completed(2L, reservation);

        assertCount("reserved", "pro", 1);
        assertCount("completed", "pro", 1);
    }

    private void assertCount(String outcome, String tier, double expected) {
        assertThat(registry.get(QuotaObservability.METRIC_NAME)
                .tags("outcome", outcome, "tier", tier)
                .counter()
                .count()).isEqualTo(expected);
    }
}
