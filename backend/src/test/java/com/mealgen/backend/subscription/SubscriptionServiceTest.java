package com.mealgen.backend.subscription;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.subscription.model.Subscription;
import com.mealgen.backend.subscription.model.SubscriptionTier;
import com.mealgen.backend.subscription.repository.SubscriptionRepository;
import com.mealgen.backend.subscription.service.SubscriptionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SubscriptionServiceTest {

    @Mock
    private SubscriptionRepository subscriptionRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private com.mealgen.backend.subscription.service.QuotaObservability quotaObservability;

    private SubscriptionService subscriptionService;

    private User freeUser;
    private User proUser;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(Instant.parse("2026-08-19T12:00:00Z"), ZoneOffset.UTC);
        subscriptionService = new SubscriptionService(
                subscriptionRepository, userRepository, clock, quotaObservability);
        freeUser = User.builder()
                .id(1L)
                .email("free@example.com")
                .plansGeneratedCount(0)
                .quotaPeriodStart(LocalDate.of(2026, 8, 1))
                .build();

        proUser = User.builder()
                .id(2L)
                .email("pro@example.com")
                .plansGeneratedCount(0)
                .quotaPeriodStart(LocalDate.of(2026, 8, 1))
                .build();
    }

    // -------------------------------------------------------------------------
    // getTier()
    // -------------------------------------------------------------------------

    @Test
    void getTier_returnsFree_whenNoSubscriptionRow() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());

        SubscriptionTier tier = subscriptionService.getTier(1L);

        assertThat(tier).isEqualTo(SubscriptionTier.FREE);
    }

    @Test
    void getTier_returnsPro_whenActiveSubscriptionExists() {
        Subscription sub = buildSubscription("active");
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.of(sub));

        SubscriptionTier tier = subscriptionService.getTier(1L);

        assertThat(tier).isEqualTo(SubscriptionTier.PRO);
    }

    @Test
    void getTier_returnsFree_whenSubscriptionIsCanceled() {
        Subscription sub = buildSubscription("canceled");
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.of(sub));

        SubscriptionTier tier = subscriptionService.getTier(1L);

        assertThat(tier).isEqualTo(SubscriptionTier.FREE);
    }

    @Test
    void getTier_returnsPro_whenSubscriptionIsPastDue_graceperiod() {
        Subscription sub = buildSubscription("past_due");
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.of(sub));

        SubscriptionTier tier = subscriptionService.getTier(1L);

        assertThat(tier).isEqualTo(SubscriptionTier.PRO);
    }

    @Test
    void getTier_returnsFree_whenSubscriptionIsUnpaid() {
        Subscription sub = buildSubscription("unpaid");
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.of(sub));

        SubscriptionTier tier = subscriptionService.getTier(1L);

        assertThat(tier).isEqualTo(SubscriptionTier.FREE);
    }

    // -------------------------------------------------------------------------
    // canGenerate()
    // -------------------------------------------------------------------------

    @Test
    void canGenerate_returnsTrue_forFreeUserWith0Plans() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        freeUser.setPlansGeneratedCount(0);

        assertThat(subscriptionService.canGenerate(freeUser)).isTrue();
    }

    @Test
    void canGenerate_returnsTrue_forFreeUserWith1Plan() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        freeUser.setPlansGeneratedCount(1);

        assertThat(subscriptionService.canGenerate(freeUser)).isTrue();
    }

    @Test
    void canGenerate_returnsTrue_forFreeUserWith2Plans() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        freeUser.setPlansGeneratedCount(2);

        assertThat(subscriptionService.canGenerate(freeUser)).isTrue();
    }

    @Test
    void canGenerate_returnsFalse_forFreeUserWith3Plans() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        freeUser.setPlansGeneratedCount(3);

        assertThat(subscriptionService.canGenerate(freeUser)).isFalse();
    }

    @Test
    void canGenerate_returnsFalse_forFreeUserWith5Plans() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        freeUser.setPlansGeneratedCount(5);

        assertThat(subscriptionService.canGenerate(freeUser)).isFalse();
    }

    @Test
    void canGenerate_returnsTrue_forProUserWith0Plans() {
        Subscription sub = buildSubscription("active");
        when(subscriptionRepository.findByUserId(2L)).thenReturn(Optional.of(sub));
        proUser.setPlansGeneratedCount(0);

        assertThat(subscriptionService.canGenerate(proUser)).isTrue();
    }

    @Test
    void canGenerate_returnsTrue_forProUserWith5Plans() {
        Subscription sub = buildSubscription("active");
        when(subscriptionRepository.findByUserId(2L)).thenReturn(Optional.of(sub));
        proUser.setPlansGeneratedCount(5);

        assertThat(subscriptionService.canGenerate(proUser)).isTrue();
    }

    @Test
    void canGenerate_returnsTrue_forProUserWith100Plans() {
        Subscription sub = buildSubscription("active");
        when(subscriptionRepository.findByUserId(2L)).thenReturn(Optional.of(sub));
        proUser.setPlansGeneratedCount(100);

        assertThat(subscriptionService.canGenerate(proUser)).isTrue();
    }

    // -------------------------------------------------------------------------
    // getRemainingQuota()
    // -------------------------------------------------------------------------

    @Test
    void getRemainingQuota_returns3_forFreeUserWith0Plans() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        freeUser.setPlansGeneratedCount(0);

        assertThat(subscriptionService.getRemainingQuota(freeUser)).isEqualTo(3);
    }

    @Test
    void getRemainingQuota_returns1_forFreeUserWith2Plans() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        freeUser.setPlansGeneratedCount(2);

        assertThat(subscriptionService.getRemainingQuota(freeUser)).isEqualTo(1);
    }

    @Test
    void getRemainingQuota_returns0_forFreeUserWith3Plans() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        freeUser.setPlansGeneratedCount(3);

        assertThat(subscriptionService.getRemainingQuota(freeUser)).isEqualTo(0);
    }

    @Test
    void getRemainingQuota_returns0_forFreeUserWithMoreThan3Plans() {
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());
        freeUser.setPlansGeneratedCount(10);

        assertThat(subscriptionService.getRemainingQuota(freeUser)).isEqualTo(0);
    }

    @Test
    void getRemainingQuota_returnsNegativeOne_forProUser() {
        Subscription sub = buildSubscription("active");
        when(subscriptionRepository.findByUserId(2L)).thenReturn(Optional.of(sub));
        proUser.setPlansGeneratedCount(0);

        assertThat(subscriptionService.getRemainingQuota(proUser)).isEqualTo(-1);
    }

    @Test
    void getRemainingQuota_returnsNegativeOne_forProUserWithManyPlans() {
        Subscription sub = buildSubscription("active");
        when(subscriptionRepository.findByUserId(2L)).thenReturn(Optional.of(sub));
        proUser.setPlansGeneratedCount(999);

        assertThat(subscriptionService.getRemainingQuota(proUser)).isEqualTo(-1);
    }

    // -------------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------------

    private Subscription buildSubscription(String status) {
        Subscription sub = new Subscription();
        sub.setStripeSubscriptionId("sub_test123");
        sub.setStripeCustomerId("cus_test123");
        sub.setStatus(status);
        sub.setTier("PRO");
        sub.setCancelAtPeriodEnd(false);
        return sub;
    }
}
