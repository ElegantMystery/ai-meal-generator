package com.mealgen.backend.subscription;

import com.mealgen.backend.subscription.controller.StripeWebhookController;
import com.mealgen.backend.subscription.service.SubscriptionService;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.net.Webhook;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for the Stripe webhook controller.
 *
 * Verifies:
 * - Invalid or missing signature → 400
 * - Valid recognized events → dispatched to service, 200 returned
 * - Unrecognized events → 200 (Stripe best practice: always ack)
 */
@ExtendWith(MockitoExtension.class)
class StripeWebhookControllerTest {

    @Mock
    private SubscriptionService subscriptionService;

    @InjectMocks
    private StripeWebhookController stripeWebhookController;

    @org.junit.jupiter.api.BeforeEach
    void injectWebhookSecret() {
        ReflectionTestUtils.setField(stripeWebhookController, "webhookSecret", "whsec_test_secret");
    }

    // -------------------------------------------------------------------------
    // Signature validation
    // -------------------------------------------------------------------------

    @Test
    void handleWebhook_returns400_whenSignatureHeaderIsMissing() {
        ResponseEntity<?> response = stripeWebhookController.handleWebhook("{}", null);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void handleWebhook_returns400_whenSignatureHeaderIsBlank() {
        ResponseEntity<?> response = stripeWebhookController.handleWebhook("{}", "   ");

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void handleWebhook_returns400_whenSignatureVerificationFails() throws Exception {
        try (MockedStatic<Webhook> webhookMock = mockStatic(Webhook.class)) {
            webhookMock.when(() -> Webhook.constructEvent(anyString(), anyString(), anyString()))
                    .thenThrow(new SignatureVerificationException("invalid", "bad-sig"));

            ResponseEntity<?> response = stripeWebhookController.handleWebhook(
                    "{\"type\":\"checkout.session.completed\"}",
                    "t=1234,v1=invalid_signature"
            );

            assertThat(response.getStatusCode().value()).isEqualTo(400);
        }
    }

    // -------------------------------------------------------------------------
    // checkout.session.completed event
    // -------------------------------------------------------------------------

    @Test
    void handleWebhook_returns200_andDispatchesCheckoutCompleted() throws Exception {
        String payload = "{\"type\":\"checkout.session.completed\",\"data\":{\"object\":{}}}";
        com.stripe.model.Event mockEvent = buildMockEvent("checkout.session.completed", payload);

        try (MockedStatic<Webhook> webhookMock = mockStatic(Webhook.class)) {
            webhookMock.when(() -> Webhook.constructEvent(anyString(), anyString(), anyString()))
                    .thenReturn(mockEvent);

            ResponseEntity<?> response = stripeWebhookController.handleWebhook(payload, "t=1234,v1=sig");

            assertThat(response.getStatusCode().value()).isEqualTo(200);
            verify(subscriptionService).handleCheckoutCompleted(any());
        }
    }

    // -------------------------------------------------------------------------
    // customer.subscription.updated event
    // -------------------------------------------------------------------------

    @Test
    void handleWebhook_returns200_andDispatchesSubscriptionUpdated() throws Exception {
        String payload = "{\"type\":\"customer.subscription.updated\",\"data\":{\"object\":{}}}";
        com.stripe.model.Event mockEvent = buildMockEvent("customer.subscription.updated", payload);

        try (MockedStatic<Webhook> webhookMock = mockStatic(Webhook.class)) {
            webhookMock.when(() -> Webhook.constructEvent(anyString(), anyString(), anyString()))
                    .thenReturn(mockEvent);

            ResponseEntity<?> response = stripeWebhookController.handleWebhook(payload, "t=1234,v1=sig");

            assertThat(response.getStatusCode().value()).isEqualTo(200);
            verify(subscriptionService).handleSubscriptionUpdated(any());
        }
    }

    // -------------------------------------------------------------------------
    // customer.subscription.deleted event
    // -------------------------------------------------------------------------

    @Test
    void handleWebhook_returns200_andDispatchesSubscriptionDeleted() throws Exception {
        String payload = "{\"type\":\"customer.subscription.deleted\",\"data\":{\"object\":{}}}";
        com.stripe.model.Event mockEvent = buildMockEvent("customer.subscription.deleted", payload);

        try (MockedStatic<Webhook> webhookMock = mockStatic(Webhook.class)) {
            webhookMock.when(() -> Webhook.constructEvent(anyString(), anyString(), anyString()))
                    .thenReturn(mockEvent);

            ResponseEntity<?> response = stripeWebhookController.handleWebhook(payload, "t=1234,v1=sig");

            assertThat(response.getStatusCode().value()).isEqualTo(200);
            verify(subscriptionService).handleSubscriptionDeleted(any());
        }
    }

    // -------------------------------------------------------------------------
    // Unrecognized events — always ack with 200
    // -------------------------------------------------------------------------

    @Test
    void handleWebhook_returns200_forUnrecognizedEventType() throws Exception {
        String payload = "{\"type\":\"invoice.paid\",\"data\":{\"object\":{}}}";
        com.stripe.model.Event mockEvent = buildMockEvent("invoice.paid", payload);

        try (MockedStatic<Webhook> webhookMock = mockStatic(Webhook.class)) {
            webhookMock.when(() -> Webhook.constructEvent(anyString(), anyString(), anyString()))
                    .thenReturn(mockEvent);

            ResponseEntity<?> response = stripeWebhookController.handleWebhook(payload, "t=1234,v1=sig");

            assertThat(response.getStatusCode().value()).isEqualTo(200);
            verifyNoInteractions(subscriptionService);
        }
    }

    // -------------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------------

    private com.stripe.model.Event buildMockEvent(String type, String rawJson) {
        com.stripe.model.Event event = mock(com.stripe.model.Event.class);
        when(event.getType()).thenReturn(type);
        return event;
    }
}
