package com.mealgen.backend.subscription;

import com.mealgen.backend.subscription.repository.StripeWebhookEventRepository;
import com.mealgen.backend.subscription.service.StripeWebhookService;
import com.mealgen.backend.subscription.service.SubscriptionService;
import com.mealgen.backend.subscription.service.StripeWebhookObservability;
import com.stripe.model.Event;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class StripeWebhookServiceTest {

    @Mock StripeWebhookEventRepository eventRepository;
    @Mock SubscriptionService subscriptionService;
    @Mock Event event;
    @Mock StripeWebhookObservability observability;

    private StripeWebhookService service;

    @BeforeEach
    void setUp() {
        service = new StripeWebhookService(eventRepository, subscriptionService, observability);
        when(event.getId()).thenReturn("evt_123");
        org.mockito.Mockito.lenient().when(event.getType())
                .thenReturn("customer.subscription.updated");
        org.mockito.Mockito.lenient().when(event.getCreated())
                .thenReturn(1_787_205_600L);
    }

    @Test
    void process_claimsBeforeDispatchAndMarksSuccess() {
        when(eventRepository.claim(
                "evt_123",
                "customer.subscription.updated",
                Instant.ofEpochSecond(1_787_205_600L)
        )).thenReturn(1);
        when(eventRepository.markProcessed("evt_123")).thenReturn(1);

        service.process(event);

        verify(subscriptionService).handleSubscriptionUpdated(event);
        verify(eventRepository).markProcessed("evt_123");
        verify(observability).record("received", "customer.subscription.updated");
        verify(observability).record("processed", "customer.subscription.updated");
    }

    @Test
    void process_duplicateClaimIsSuccessfulNoOp() {
        when(eventRepository.claim(
                "evt_123",
                "customer.subscription.updated",
                Instant.ofEpochSecond(1_787_205_600L)
        )).thenReturn(0);

        service.process(event);

        verify(subscriptionService, never()).handleSubscriptionUpdated(event);
        verify(eventRepository, never()).markProcessed("evt_123");
        verify(observability).record("retried", "customer.subscription.updated");
    }

    @Test
    void process_handlerFailurePropagatesAndDoesNotMarkProcessed() {
        when(eventRepository.claim(
                "evt_123",
                "customer.subscription.updated",
                Instant.ofEpochSecond(1_787_205_600L)
        )).thenReturn(1);
        RuntimeException failure = new RuntimeException("database unavailable");
        org.mockito.Mockito.doThrow(failure)
                .when(subscriptionService).handleSubscriptionUpdated(event);

        assertThatThrownBy(() -> service.process(event)).isSameAs(failure);
        verify(eventRepository, never()).markProcessed("evt_123");
        verify(observability).record("failed", "customer.subscription.updated");
    }

    @Test
    void process_unhandledEventIsStillRecorded() {
        when(event.getType()).thenReturn("invoice.created");
        when(eventRepository.claim(
                "evt_123",
                "invoice.created",
                Instant.ofEpochSecond(1_787_205_600L)
        )).thenReturn(1);
        when(eventRepository.markProcessed("evt_123")).thenReturn(1);

        service.process(event);

        verify(eventRepository).markProcessed("evt_123");
        verify(subscriptionService, never()).handleCheckoutCompleted(event);
        verify(subscriptionService, never()).handleSubscriptionUpdated(event);
        verify(subscriptionService, never()).handleSubscriptionDeleted(event);
    }

    @Test
    void process_rejectsMissingEventIdBeforeClaim() {
        when(event.getId()).thenReturn(null);

        assertThatThrownBy(() -> service.process(event))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("event id");

        verify(eventRepository, never()).claim(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()
        );
    }
}
