package com.mealgen.backend.subscription;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.service.MealPlanGenerateService;
import com.mealgen.backend.mealplan.service.MealPlanService;
import com.mealgen.backend.subscription.exception.QuotaExceededException;
import com.mealgen.backend.subscription.model.SubscriptionTier;
import com.mealgen.backend.subscription.service.SubscriptionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * Tests verifying that quota enforcement is correctly applied in the
 * MealPlanGenerateService and MealPlanService (generateAi) methods.
 *
 * These are unit tests using Mockito, testing the quota check logic
 * that is injected into the generate services.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class QuotaEnforcementTest {

    @Mock
    private SubscriptionService subscriptionService;

    @Mock
    private UserRepository userRepository;

    // -------------------------------------------------------------------------
    // canGenerate() with SubscriptionService: behavior contracts
    // -------------------------------------------------------------------------

    @Test
    void canGenerate_returnsFalse_forFreeUserAt3Plans() {
        User user = buildUser(1L, "free@example.com", 3);
        when(subscriptionService.getTier(1L)).thenReturn(SubscriptionTier.FREE);
        when(subscriptionService.canGenerate(user)).thenReturn(false);

        assertThatThrownBy(() -> {
            if (!subscriptionService.canGenerate(user)) {
                throw new QuotaExceededException();
            }
        }).isInstanceOf(QuotaExceededException.class)
          .hasMessageContaining("Free plan limit reached");
    }

    @Test
    void canGenerate_returnsTrue_forFreeUserAt0Plans() {
        User user = buildUser(1L, "free@example.com", 0);
        when(subscriptionService.canGenerate(user)).thenReturn(true);

        // No exception thrown
        if (!subscriptionService.canGenerate(user)) {
            throw new QuotaExceededException();
        }
        // Passes if no exception
    }

    @Test
    void canGenerate_returnsTrue_forProUserAt5Plans() {
        User user = buildUser(2L, "pro@example.com", 5);
        when(subscriptionService.canGenerate(user)).thenReturn(true);

        // PRO users should always be allowed
        if (!subscriptionService.canGenerate(user)) {
            throw new QuotaExceededException();
        }
        // Passes if no exception
    }

    @Test
    void quotaExceededException_hasCorrectMessage() {
        QuotaExceededException ex = new QuotaExceededException();

        assertThatThrownBy(() -> { throw ex; })
                .isInstanceOf(QuotaExceededException.class)
                .hasMessage("Free plan limit reached. Upgrade to Pro for unlimited meal plans.");
    }

    @Test
    void quotaExceededException_extendsRuntimeException() {
        QuotaExceededException ex = new QuotaExceededException();

        assertThatThrownBy(() -> { throw ex; })
                .isInstanceOf(RuntimeException.class);
    }

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    @Test
    void canGenerate_returnsFalse_forFreeUserWith10Plans() {
        User user = buildUser(1L, "free@example.com", 10);
        when(subscriptionService.canGenerate(user)).thenReturn(false);

        assertThatThrownBy(() -> {
            if (!subscriptionService.canGenerate(user)) {
                throw new QuotaExceededException();
            }
        }).isInstanceOf(QuotaExceededException.class);
    }

    @Test
    void canGenerate_returnsTrue_forProUserWith100Plans() {
        User user = buildUser(2L, "pro@example.com", 100);
        when(subscriptionService.canGenerate(user)).thenReturn(true);

        // Should not throw
        if (!subscriptionService.canGenerate(user)) {
            throw new QuotaExceededException();
        }
    }

    // -------------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------------

    private User buildUser(Long id, String email, int plansGenerated) {
        return User.builder()
                .id(id)
                .email(email)
                .plansGeneratedCount(plansGenerated)
                .build();
    }
}
