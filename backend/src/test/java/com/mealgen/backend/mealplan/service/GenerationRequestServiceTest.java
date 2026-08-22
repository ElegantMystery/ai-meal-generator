package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.mealplan.model.GenerationRequest;
import com.mealgen.backend.mealplan.model.GenerationRequestStatus;
import com.mealgen.backend.mealplan.repository.GenerationRequestRepository;
import com.mealgen.backend.subscription.service.QuotaReservation;
import com.mealgen.backend.subscription.service.SubscriptionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class GenerationRequestServiceTest {
    private static final Instant NOW = Instant.parse("2026-08-22T12:00:00Z");

    @Mock GenerationRequestRepository repository;
    @Mock SubscriptionService subscriptionService;
    private GenerationRequestService service;
    private User user;

    @BeforeEach
    void setUp() {
        service = new GenerationRequestService(
                repository, Clock.fixed(NOW, ZoneOffset.UTC), subscriptionService);
        user = User.builder().id(7L).email("user@example.com").build();
    }

    @Test
    void claim_insertsOnceAndReturnsOwner() {
        GenerationRequest request = request("key-1", "abc");
        when(repository.insertPending(any(), eq(7L), eq("key-1"), eq("abc"), any())).thenReturn(1);
        when(repository.findByUserIdAndIdempotencyKey(7L, "key-1")).thenReturn(Optional.of(request));

        GenerationRequestClaim claim = service.claim(user, "key-1", "abc");

        assertThat(claim.owner()).isTrue();
        assertThat(claim.request()).isSameAs(request);
    }

    @Test
    void claim_duplicateWithDifferentPayloadIsRejected() {
        GenerationRequest existing = request("key-1", "original");
        when(repository.insertPending(any(), eq(7L), eq("key-1"), eq("changed"), any())).thenReturn(0);
        when(repository.findByUserIdAndIdempotencyKey(7L, "key-1")).thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> service.claim(user, "key-1", "changed"))
                .isInstanceOf(IdempotencyConflictException.class);
    }

    @Test
    void start_reservesAndRecordsTheExactQuotaReservation() {
        UUID id = UUID.randomUUID();
        QuotaReservation reservation = QuotaReservation.free(LocalDate.of(2026, 8, 1));
        when(subscriptionService.reserveGeneration(user)).thenReturn(reservation);
        when(repository.markRunning(id, true, reservation.periodStart(), OffsetDateTime.ofInstant(NOW, ZoneOffset.UTC)))
                .thenReturn(1);

        assertThat(service.start(id, user)).isEqualTo(reservation);

        verify(repository).markRunning(id, true, reservation.periodStart(), OffsetDateTime.ofInstant(NOW, ZoneOffset.UTC));
    }

    @Test
    void terminalTransitionIsAnIdempotentNoOpAfterFirstCompletion() {
        UUID id = UUID.randomUUID();
        when(repository.markFailed(eq(id), eq("GENERATION_UPSTREAM_ERROR"), any())).thenReturn(0);

        assertThat(service.markFailed(id, "GENERATION_UPSTREAM_ERROR")).isFalse();
    }

    @Test
    void fail_releasesQuotaOnlyWhenThisCallWinsTheTerminalTransition() {
        UUID id = UUID.randomUUID();
        QuotaReservation reservation = QuotaReservation.free(LocalDate.of(2026, 8, 1));
        when(repository.markFailed(eq(id), eq("GENERATION_FAILED"), any())).thenReturn(1);

        assertThat(service.fail(id, user.getId(), reservation, "GENERATION_FAILED")).isTrue();

        verify(subscriptionService).releaseGeneration(user.getId(), reservation);
    }

    private GenerationRequest request(String key, String fingerprint) {
        return GenerationRequest.builder()
                .id(UUID.randomUUID())
                .user(user)
                .idempotencyKey(key)
                .requestFingerprint(fingerprint)
                .status(GenerationRequestStatus.PENDING)
                .build();
    }
}
