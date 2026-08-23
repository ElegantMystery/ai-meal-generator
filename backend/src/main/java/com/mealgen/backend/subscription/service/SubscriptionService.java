package com.mealgen.backend.subscription.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.subscription.exception.QuotaExceededException;
import com.mealgen.backend.subscription.exception.StripeWebhookProcessingException;
import com.mealgen.backend.subscription.model.Subscription;
import com.mealgen.backend.subscription.model.SubscriptionTier;
import com.mealgen.backend.subscription.repository.SubscriptionRepository;
import com.stripe.Stripe;
import com.stripe.model.Customer;
import com.stripe.model.Event;
import com.stripe.model.checkout.Session;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.billingportal.SessionCreateParams;
import com.stripe.param.checkout.SessionCreateParams.LineItem;
import com.stripe.param.checkout.SessionCreateParams.Mode;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class SubscriptionService {

    /** Statuses that grant PRO-tier access (grace period during payment retry). */
    private static final Set<String> PRO_STATUSES = Set.of("active", "past_due");

    private static final int FREE_PLAN_LIMIT = 3;

    private final SubscriptionRepository subscriptionRepository;
    private final UserRepository userRepository;
    private final Clock clock;
    private final QuotaObservability quotaObservability;

    @Value("${stripe.secret-key}")
    private String stripeSecretKey;

    @Value("${stripe.price-id}")
    private String priceId;

    @Value("${stripe.success-url}")
    private String successUrl;

    @Value("${stripe.cancel-url}")
    private String cancelUrl;

    // -------------------------------------------------------------------------
    // Tier resolution
    // -------------------------------------------------------------------------

    public SubscriptionTier getTier(Long userId) {
        return subscriptionRepository.findByUserId(userId)
                .filter(s -> PRO_STATUSES.contains(s.getStatus()))
                .map(s -> SubscriptionTier.PRO)
                .orElse(SubscriptionTier.FREE);
    }

    // -------------------------------------------------------------------------
    // Quota checks
    // -------------------------------------------------------------------------

    public boolean canGenerate(User user) {
        if (getTier(user.getId()) == SubscriptionTier.PRO) {
            return true;
        }
        return usageInCurrentPeriod(user) < FREE_PLAN_LIMIT;
    }

    public int getRemainingQuota(User user) {
        if (getTier(user.getId()) == SubscriptionTier.PRO) {
            return -1;
        }
        return Math.max(0, FREE_PLAN_LIMIT - usageInCurrentPeriod(user));
    }

    /**
     * Reserves generation capacity before any expensive work starts. The single
     * conditional UPDATE is the concurrency boundary for FREE users.
     */
    @Transactional
    public QuotaReservation reserveGeneration(User user) {
        if (getTier(user.getId()) == SubscriptionTier.PRO) {
            QuotaReservation reservation = QuotaReservation.unlimited();
            quotaObservability.reserved(user.getId(), reservation);
            observeTransactionRollback(user.getId(), reservation);
            return reservation;
        }

        LocalDate periodStart = currentQuotaPeriod();
        int updated = userRepository.reserveFreeGeneration(
                user.getId(), periodStart, FREE_PLAN_LIMIT);
        if (updated == 0) {
            quotaObservability.rejected(user.getId());
            throw new QuotaExceededException();
        }
        QuotaReservation reservation = QuotaReservation.free(periodStart);
        quotaObservability.reserved(user.getId(), reservation);
        observeTransactionRollback(user.getId(), reservation);
        return reservation;
    }

    @Transactional
    public void releaseGeneration(Long userId, QuotaReservation reservation) {
        releaseGeneration(userId, reservation, "stream_terminated");
    }

    @Transactional
    public void releaseGeneration(
            Long userId,
            QuotaReservation reservation,
            String reason
    ) {
        if (reservation == null) {
            return;
        }
        if (reservation.consumesFreeQuota()) {
            int updated = userRepository.releaseFreeGeneration(userId, reservation.periodStart());
            if (updated == 1) {
                quotaObservability.released(userId, reservation, reason);
            } else {
                quotaObservability.releaseMissed(userId, reservation, reason);
            }
        } else {
            quotaObservability.released(userId, reservation, reason);
        }
    }

    public void completeGeneration(Long userId, QuotaReservation reservation) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(
                    new TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            quotaObservability.completed(userId, reservation);
                        }
                    });
        } else {
            quotaObservability.completed(userId, reservation);
        }
    }

    private void observeTransactionRollback(Long userId, QuotaReservation reservation) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        if (status == TransactionSynchronization.STATUS_ROLLED_BACK) {
                            quotaObservability.released(
                                    userId, reservation, "transaction_rollback");
                        }
                    }
                });
    }

    private int usageInCurrentPeriod(User user) {
        return currentQuotaPeriod().equals(user.getQuotaPeriodStart())
                ? user.getPlansGeneratedCount()
                : 0;
    }

    private LocalDate currentQuotaPeriod() {
        LocalDate utcToday = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        return utcToday.withDayOfMonth(1);
    }

    // -------------------------------------------------------------------------
    // Stripe checkout session
    // -------------------------------------------------------------------------

    @Transactional
    public String createCheckoutSession(User user) throws Exception {
        Stripe.apiKey = stripeSecretKey;

        // Get or create Stripe customer
        String customerId = getOrCreateCustomerId(user);

        com.stripe.param.checkout.SessionCreateParams params =
                com.stripe.param.checkout.SessionCreateParams.builder()
                        .setMode(Mode.SUBSCRIPTION)
                        .setCustomer(customerId)
                        .addLineItem(LineItem.builder()
                                .setPrice(priceId)
                                .setQuantity(1L)
                                .build())
                        .setSuccessUrl(successUrl)
                        .setCancelUrl(cancelUrl)
                        .build();

        Session session = Session.create(params);
        return session.getUrl();
    }

    // -------------------------------------------------------------------------
    // Stripe billing portal session
    // -------------------------------------------------------------------------

    @Transactional
    public String createPortalSession(User user) throws Exception {
        Stripe.apiKey = stripeSecretKey;

        String customerId = getOrCreateCustomerId(user);

        com.stripe.model.billingportal.Session session =
                com.stripe.model.billingportal.Session.create(
                        SessionCreateParams.builder()
                                .setCustomer(customerId)
                                .setReturnUrl(successUrl)
                                .build()
                );

        return session.getUrl();
    }

    // -------------------------------------------------------------------------
    // Webhook handlers
    // -------------------------------------------------------------------------

    @Transactional
    public void handleCheckoutCompleted(Event event) {
        Stripe.apiKey = stripeSecretKey;
        com.fasterxml.jackson.databind.JsonNode obj = eventObject(event);
        String customerId = requiredJsonText(obj, "customer", "checkout customer id");
        String subscriptionId = requiredJsonText(obj, "subscription", "checkout subscription id");
        com.stripe.model.Subscription stripeSub = retrieveSubscription(subscriptionId);

        upsertSubscription(stripeSub, customerId);
    }

    @Transactional
    public void handleSubscriptionUpdated(Event event) {
        Stripe.apiKey = stripeSecretKey;
        com.fasterxml.jackson.databind.JsonNode obj = eventObject(event);
        String subscriptionId = requiredJsonText(obj, "id", "subscription id");
        com.stripe.model.Subscription stripeSub = retrieveSubscription(subscriptionId);
        String customerId = requireText(stripeSub.getCustomer(), "subscription customer id");

        // Upsert by customer as well as subscription id so an update arriving
        // before checkout.session.completed can still establish entitlement.
        upsertSubscription(stripeSub, customerId);
    }

    @Transactional
    public void handleSubscriptionDeleted(Event event) {
        Stripe.apiKey = stripeSecretKey;
        String subscriptionId = requiredJsonText(
                eventObject(event), "id", "deleted subscription id");

        // Absence is already the desired FREE entitlement state. A stale deletion
        // for an older subscription must not cancel a newer subscription row.
        subscriptionRepository.findByStripeSubscriptionId(subscriptionId)
                .ifPresent(sub -> {
                    sub.setStatus("canceled");
                    subscriptionRepository.save(sub);
                });
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /** Copies currentPeriodStart/End from the first SubscriptionItem (Stripe SDK v24+ moved these off Subscription). */
    private void applyPeriod(Subscription sub, com.stripe.model.Subscription stripeSub) {
        if (stripeSub.getItems() == null || stripeSub.getItems().getData().isEmpty()) return;
        com.stripe.model.SubscriptionItem item = stripeSub.getItems().getData().get(0);
        if (item.getCurrentPeriodStart() != null) {
            sub.setCurrentPeriodStart(Instant.ofEpochSecond(item.getCurrentPeriodStart()));
        }
        if (item.getCurrentPeriodEnd() != null) {
            sub.setCurrentPeriodEnd(Instant.ofEpochSecond(item.getCurrentPeriodEnd()));
        }
    }

    private void upsertSubscription(
            com.stripe.model.Subscription stripeSub,
            String customerId
    ) {
        User user = userRepository.findByStripeCustomerId(customerId)
                .orElseThrow(() -> new StripeWebhookProcessingException(
                        "No user found for Stripe customer " + customerId));

        Subscription sub = subscriptionRepository.findByStripeSubscriptionId(stripeSub.getId())
                .or(() -> subscriptionRepository.findByUserId(user.getId()))
                .orElseGet(Subscription::new);
        sub.setUser(user);
        sub.setStripeSubscriptionId(requireText(stripeSub.getId(), "subscription id"));
        sub.setStripeCustomerId(customerId);
        sub.setStatus(requireText(stripeSub.getStatus(), "subscription status"));
        sub.setTier("PRO");
        applyPeriod(sub, stripeSub);
        sub.setCancelAtPeriodEnd(Boolean.TRUE.equals(stripeSub.getCancelAtPeriodEnd()));
        subscriptionRepository.save(sub);

        if (!customerId.equals(user.getStripeCustomerId())) {
            user.setStripeCustomerId(customerId);
            userRepository.save(user);
        }
    }

    private com.stripe.model.Subscription retrieveSubscription(String subscriptionId) {
        try {
            return com.stripe.model.Subscription.retrieve(subscriptionId);
        } catch (Exception e) {
            throw new StripeWebhookProcessingException(
                    "Failed to retrieve Stripe subscription " + subscriptionId, e);
        }
    }

    private com.fasterxml.jackson.databind.JsonNode eventObject(Event event) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(event.toJson())
                    .path("data")
                    .path("object");
        } catch (Exception e) {
            throw new StripeWebhookProcessingException("Invalid Stripe event payload", e);
        }
    }

    private String requiredJsonText(
            com.fasterxml.jackson.databind.JsonNode object,
            String field,
            String description
    ) {
        return requireText(object.path(field).asText(null), description);
    }

    private String requireText(String value, String description) {
        if (value == null || value.isBlank() || "null".equals(value)) {
            throw new StripeWebhookProcessingException("Stripe event missing " + description);
        }
        return value;
    }

    private String getOrCreateCustomerId(User user) throws Exception {
        // Return cached customer ID if already present on user
        if (user.getStripeCustomerId() != null && !user.getStripeCustomerId().isBlank()) {
            return user.getStripeCustomerId();
        }

        // Check if there's already a subscription row with a customer ID
        Optional<Subscription> existingSub = subscriptionRepository.findByUserId(user.getId());
        if (existingSub.isPresent()) {
            return existingSub.get().getStripeCustomerId();
        }

        // Create a new Stripe customer
        Customer customer = Customer.create(
                CustomerCreateParams.builder()
                        .setEmail(user.getEmail())
                        .setName(user.getName())
                        .build()
        );

        // Persist the customer ID on the user
        user.setStripeCustomerId(customer.getId());
        userRepository.save(user);

        return customer.getId();
    }
}
