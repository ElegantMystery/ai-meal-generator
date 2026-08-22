package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.mealplan.model.GenerationRequest;
import com.mealgen.backend.mealplan.model.GenerationRequestStatus;
import com.mealgen.backend.mealplan.repository.GenerationRequestRepository;
import com.mealgen.backend.subscription.service.SubscriptionService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class GenerationRequestCleanupServiceTest {
    @Mock GenerationRequestRepository repository;
    @Mock SubscriptionService subscriptionService;

    @Test
    void cleanup_abandonsStaleRequestAndReleasesItsReservation() {
        User user = User.builder().id(9L).email("user@example.com").build();
        GenerationRequest request = GenerationRequest.builder()
                .user(user)
                .status(GenerationRequestStatus.RUNNING)
                .quotaConsumed(true)
                .quotaPeriodStart(LocalDate.of(2026, 8, 1))
                .build();
        GenerationRequestCleanupService service = new GenerationRequestCleanupService(
                repository, subscriptionService,
                Clock.fixed(Instant.parse("2026-08-22T12:00:00Z"), ZoneOffset.UTC));
        ReflectionTestUtils.setField(service, "staleAfter", Duration.ofMinutes(30));
        ReflectionTestUtils.setField(service, "retention", Duration.ofDays(30));
        when(repository.lockStale(anyList(), any(), any())).thenReturn(List.of(request));

        service.cleanup();

        assertThat(request.getStatus()).isEqualTo(GenerationRequestStatus.ABANDONED);
        assertThat(request.getFailureCode()).isEqualTo("GENERATION_ABANDONED");
        assertThat(request.isQuotaConsumed()).isFalse();
        verify(subscriptionService).releaseGeneration(eq(9L), any());
        verify(repository).deleteCompletedBefore(anyList(), any());
    }
}
