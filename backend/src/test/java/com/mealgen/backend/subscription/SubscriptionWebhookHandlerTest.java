package com.mealgen.backend.subscription;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.subscription.exception.StripeWebhookProcessingException;
import com.mealgen.backend.subscription.model.Subscription;
import com.mealgen.backend.subscription.repository.SubscriptionRepository;
import com.mealgen.backend.subscription.service.SubscriptionService;
import com.stripe.model.Event;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SubscriptionWebhookHandlerTest {

    @Mock SubscriptionRepository subscriptionRepository;
    @Mock UserRepository userRepository;
    @Mock Event event;
    @Mock com.stripe.model.Subscription stripeSubscription;

    private SubscriptionService service;
    private User user;

    @BeforeEach
    void setUp() {
        service = new SubscriptionService(
                subscriptionRepository, userRepository, Clock.systemUTC());
        user = User.builder()
                .id(1L)
                .email("user@example.com")
                .stripeCustomerId("cus_123")
                .build();
    }

    @Test
    void subscriptionUpdated_upsertsWhenCheckoutEventHasNotArrived() throws Exception {
        when(event.toJson()).thenReturn(eventJson("sub_123", "cus_123"));
        when(stripeSubscription.getId()).thenReturn("sub_123");
        when(stripeSubscription.getCustomer()).thenReturn("cus_123");
        when(stripeSubscription.getStatus()).thenReturn("active");
        when(userRepository.findByStripeCustomerId("cus_123")).thenReturn(Optional.of(user));
        when(subscriptionRepository.findByStripeSubscriptionId("sub_123"))
                .thenReturn(Optional.empty());
        when(subscriptionRepository.findByUserId(1L)).thenReturn(Optional.empty());

        try (MockedStatic<com.stripe.model.Subscription> stripe =
                     mockStatic(com.stripe.model.Subscription.class)) {
            stripe.when(() -> com.stripe.model.Subscription.retrieve("sub_123"))
                    .thenReturn(stripeSubscription);

            service.handleSubscriptionUpdated(event);
        }

        org.mockito.ArgumentCaptor<Subscription> saved =
                org.mockito.ArgumentCaptor.forClass(Subscription.class);
        verify(subscriptionRepository).save(saved.capture());
        assertThat(saved.getValue().getUser()).isSameAs(user);
        assertThat(saved.getValue().getStripeSubscriptionId()).isEqualTo("sub_123");
        assertThat(saved.getValue().getStripeCustomerId()).isEqualTo("cus_123");
        assertThat(saved.getValue().getStatus()).isEqualTo("active");
        assertThat(saved.getValue().getTier()).isEqualTo("PRO");
    }

    @Test
    void subscriptionUpdated_missingUserPropagatesForRetry() throws Exception {
        when(event.toJson()).thenReturn(eventJson("sub_123", "cus_missing"));
        when(stripeSubscription.getCustomer()).thenReturn("cus_missing");
        when(userRepository.findByStripeCustomerId("cus_missing")).thenReturn(Optional.empty());

        try (MockedStatic<com.stripe.model.Subscription> stripe =
                     mockStatic(com.stripe.model.Subscription.class)) {
            stripe.when(() -> com.stripe.model.Subscription.retrieve("sub_123"))
                    .thenReturn(stripeSubscription);

            assertThatThrownBy(() -> service.handleSubscriptionUpdated(event))
                    .isInstanceOf(StripeWebhookProcessingException.class)
                    .hasMessageContaining("cus_missing");
        }

        verify(subscriptionRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void malformedEventPropagatesForRetry() {
        when(event.toJson()).thenReturn("not-json");

        assertThatThrownBy(() -> service.handleSubscriptionUpdated(event))
                .isInstanceOf(StripeWebhookProcessingException.class)
                .hasMessageContaining("Invalid Stripe event payload");
    }

    @Test
    void staleDeletionDoesNotCancelNewerSubscription() {
        when(event.toJson()).thenReturn(eventJson("sub_old", "cus_123"));
        when(subscriptionRepository.findByStripeSubscriptionId("sub_old"))
                .thenReturn(Optional.empty());

        service.handleSubscriptionDeleted(event);

        verify(subscriptionRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }

    private static String eventJson(String subscriptionId, String customerId) {
        return "{\"data\":{\"object\":{\"id\":\"" + subscriptionId
                + "\",\"customer\":\"" + customerId + "\"}}}";
    }
}
