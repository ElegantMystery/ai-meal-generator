package com.mealgen.backend.subscription;

import com.mealgen.backend.subscription.model.StripeWebhookEvent;
import com.mealgen.backend.subscription.repository.StripeWebhookEventRepository;
import com.mealgen.backend.subscription.service.StripeWebhookService;
import com.mealgen.backend.subscription.service.SubscriptionService;
import com.mealgen.backend.support.PostgresIntegrationTest;
import com.stripe.model.Event;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(StripeWebhookService.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class StripeWebhookPostgresTransactionTest extends PostgresIntegrationTest {

    @Autowired StripeWebhookService webhookService;
    @Autowired StripeWebhookEventRepository eventRepository;
    @MockitoBean SubscriptionService subscriptionService;

    @Test
    void concurrentDuplicateDeliveryIsProcessedExactlyOnce() throws Exception {
        Event event = event("evt_concurrent", "checkout.session.completed");
        int contenderCount = 8;
        CountDownLatch ready = new CountDownLatch(contenderCount);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> deliveries = new ArrayList<>();

        try (var executor = Executors.newFixedThreadPool(contenderCount)) {
            for (int i = 0; i < contenderCount; i++) {
                deliveries.add(executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    webhookService.process(event);
                    return null;
                }));
            }

            ready.await();
            start.countDown();
            for (Future<?> delivery : deliveries) {
                delivery.get();
            }
        }

        List<StripeWebhookEvent> rows = eventRepository.findAll();
        assertThat(rows).singleElement().satisfies(row -> {
            assertThat(row.getEventId()).isEqualTo("evt_concurrent");
            assertThat(row.getProcessedAt()).isNotNull();
        });
        verify(subscriptionService).handleCheckoutCompleted(event);
        eventRepository.deleteAll();
    }

    @Test
    void handlerFailureRollsBackClaimSoDeliveryCanBeRetried() {
        Event event = event("evt_retry", "customer.subscription.updated");
        doThrow(new IllegalStateException("transient database failure"))
                .doNothing()
                .when(subscriptionService).handleSubscriptionUpdated(event);

        assertThatThrownBy(() -> webhookService.process(event))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("transient database failure");
        assertThat(eventRepository.findById("evt_retry")).isEmpty();

        webhookService.process(event);

        assertThat(eventRepository.findById("evt_retry"))
                .get()
                .extracting(StripeWebhookEvent::getProcessedAt)
                .isNotNull();
        verify(subscriptionService, org.mockito.Mockito.times(2)).handleSubscriptionUpdated(event);
        eventRepository.deleteAll();
    }

    private static Event event(String id, String type) {
        Event event = new Event();
        event.setId(id);
        event.setType(type);
        event.setCreated(1_776_297_600L);
        return event;
    }
}
