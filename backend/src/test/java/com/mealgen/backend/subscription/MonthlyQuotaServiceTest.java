package com.mealgen.backend.subscription;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.subscription.exception.QuotaExceededException;
import com.mealgen.backend.subscription.repository.SubscriptionRepository;
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
import java.time.ZoneOffset;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MonthlyQuotaServiceTest {

    private static final LocalDate AUGUST = LocalDate.of(2026, 8, 1);

    @Mock SubscriptionRepository subscriptionRepository;
    @Mock UserRepository userRepository;

    private SubscriptionService service;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(Instant.parse("2026-08-19T12:00:00Z"), ZoneOffset.UTC);
        service = new SubscriptionService(subscriptionRepository, userRepository, clock);
    }

    @Test
    void remainingQuota_resetsAtUtcMonthBoundaryWithoutScheduler() {
        User user = freeUser(3, LocalDate.of(2026, 7, 1));
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());

        assertThat(service.getRemainingQuota(user)).isEqualTo(3);
    }

    @Test
    void remainingQuota_usesCurrentMonthCount() {
        User user = freeUser(2, AUGUST);
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());

        assertThat(service.getRemainingQuota(user)).isEqualTo(1);
    }

    @Test
    void reserveGeneration_usesOneConditionalDatabaseUpdate() {
        User user = freeUser(2, AUGUST);
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        when(userRepository.reserveFreeGeneration(1L, AUGUST, 3)).thenReturn(1);

        QuotaReservation reservation = service.reserveGeneration(user);

        assertThat(reservation.consumesFreeQuota()).isTrue();
        assertThat(reservation.periodStart()).isEqualTo(AUGUST);
        verify(userRepository).reserveFreeGeneration(1L, AUGUST, 3);
    }

    @Test
    void reserveGeneration_rejectsWhenConditionalUpdateLosesRace() {
        User user = freeUser(2, AUGUST);
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        when(userRepository.reserveFreeGeneration(1L, AUGUST, 3)).thenReturn(0);

        assertThatThrownBy(() -> service.reserveGeneration(user))
                .isInstanceOf(QuotaExceededException.class);
    }

    @Test
    void reserveGeneration_doesNotTouchQuotaForPro() {
        User user = freeUser(99, AUGUST);
        when(subscriptionRepository.findByUserId(1L))
                .thenReturn(Optional.of(subscription("active")));

        assertThat(service.reserveGeneration(user).consumesFreeQuota()).isFalse();
        verify(userRepository, never()).reserveFreeGeneration(1L, AUGUST, 3);
    }

    @Test
    void releaseGeneration_onlyTargetsReservationsPeriod() {
        QuotaReservation reservation = QuotaReservation.free(AUGUST);

        service.releaseGeneration(1L, reservation);

        verify(userRepository).releaseFreeGeneration(1L, AUGUST);
    }

    private static User freeUser(int count, LocalDate periodStart) {
        return User.builder()
                .id(1L)
                .email("free@example.com")
                .plansGeneratedCount(count)
                .quotaPeriodStart(periodStart)
                .build();
    }

    private static com.mealgen.backend.subscription.model.Subscription subscription(String status) {
        var subscription = new com.mealgen.backend.subscription.model.Subscription();
        subscription.setStatus(status);
        return subscription;
    }
}
