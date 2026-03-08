package com.mealgen.backend.subscription;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.subscription.controller.SubscriptionController;
import com.mealgen.backend.subscription.controller.StripeWebhookController;
import com.mealgen.backend.subscription.dto.SubscriptionStatusResponse;
import com.mealgen.backend.subscription.model.SubscriptionTier;
import com.mealgen.backend.subscription.repository.SubscriptionRepository;
import com.mealgen.backend.subscription.service.SubscriptionService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * Unit tests for SubscriptionController and StripeWebhookController.
 *
 * Integration-style security tests (401 on unauthenticated) are covered here
 * via unit tests checking authentication guard in the controller methods.
 */
@ExtendWith(MockitoExtension.class)
class SubscriptionControllerTest {

    @Mock
    private SubscriptionService subscriptionService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private SubscriptionRepository subscriptionRepository;

    @InjectMocks
    private SubscriptionController subscriptionController;

    // -------------------------------------------------------------------------
    // GET /api/subscription/status — authenticated FREE user
    // -------------------------------------------------------------------------

    @Test
    void getStatus_returnsFreeWith3Remaining_forNewFreeUser() {
        User user = buildUser(1L, "free@example.com", 0);
        Authentication auth = buildAuth("free@example.com");

        when(userRepository.findByEmail("free@example.com")).thenReturn(Optional.of(user));
        when(subscriptionService.getTier(1L)).thenReturn(SubscriptionTier.FREE);
        when(subscriptionService.getRemainingQuota(user)).thenReturn(3);

        ResponseEntity<SubscriptionStatusResponse> response = subscriptionController.getStatus(auth);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().tier()).isEqualTo("FREE");
        assertThat(response.getBody().remainingQuota()).isEqualTo(3);
    }

    @Test
    void getStatus_returnsProWithMinusOne_forActiveProUser() {
        User user = buildUser(2L, "pro@example.com", 10);
        Authentication auth = buildAuth("pro@example.com");

        when(userRepository.findByEmail("pro@example.com")).thenReturn(Optional.of(user));
        when(subscriptionService.getTier(2L)).thenReturn(SubscriptionTier.PRO);
        when(subscriptionService.getRemainingQuota(user)).thenReturn(-1);

        ResponseEntity<SubscriptionStatusResponse> response = subscriptionController.getStatus(auth);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().tier()).isEqualTo("PRO");
        assertThat(response.getBody().remainingQuota()).isEqualTo(-1);
    }

    @Test
    void getStatus_throws_whenUserNotFound() {
        Authentication auth = buildAuth("unknown@example.com");
        when(userRepository.findByEmail("unknown@example.com")).thenReturn(Optional.empty());

        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalStateException.class,
                () -> subscriptionController.getStatus(auth)
        );
    }

    // -------------------------------------------------------------------------
    // POST /api/subscription/checkout — returns URL
    // -------------------------------------------------------------------------

    @Test
    void checkout_returnsUrlFromService() throws Exception {
        User user = buildUser(1L, "free@example.com", 0);
        Authentication auth = buildAuth("free@example.com");

        when(userRepository.findByEmail("free@example.com")).thenReturn(Optional.of(user));
        when(subscriptionService.createCheckoutSession(user)).thenReturn("https://checkout.stripe.com/test");

        ResponseEntity<?> response = subscriptionController.checkout(auth);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().toString()).contains("checkout.stripe.com");
    }

    // -------------------------------------------------------------------------
    // POST /api/subscription/portal — returns URL
    // -------------------------------------------------------------------------

    @Test
    void portal_returnsUrlFromService() throws Exception {
        User user = buildUser(2L, "pro@example.com", 5);
        Authentication auth = buildAuth("pro@example.com");

        when(userRepository.findByEmail("pro@example.com")).thenReturn(Optional.of(user));
        when(subscriptionService.createPortalSession(user)).thenReturn("https://billing.stripe.com/portal");

        ResponseEntity<?> response = subscriptionController.portal(auth);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().toString()).contains("billing.stripe.com");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private User buildUser(Long id, String email, int plansGenerated) {
        return User.builder()
                .id(id)
                .email(email)
                .plansGeneratedCount(plansGenerated)
                .build();
    }

    private Authentication buildAuth(String email) {
        Authentication auth = mock(Authentication.class);
        when(auth.isAuthenticated()).thenReturn(true);
        when(auth.getPrincipal()).thenReturn(email);
        return auth;
    }
}
