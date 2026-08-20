package com.mealgen.backend.subscription.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.subscription.exception.QuotaExceededException;
import com.mealgen.backend.subscription.model.Subscription;
import com.mealgen.backend.subscription.model.SubscriptionTier;
import com.mealgen.backend.subscription.repository.SubscriptionRepository;
import com.stripe.Stripe;
import com.stripe.model.Customer;
import com.stripe.model.Event;
import com.stripe.model.checkout.Session;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.CustomerSearchParams;
import com.stripe.param.billingportal.SessionCreateParams;
import com.stripe.param.checkout.SessionCreateParams.LineItem;
import com.stripe.param.checkout.SessionCreateParams.Mode;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class SubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    /** Statuses that grant PRO-tier access (grace period during payment retry). */
    private static final Set<String> PRO_STATUSES = Set.of("active", "past_due");

    private static final int FREE_PLAN_LIMIT = 3;

    private final SubscriptionRepository subscriptionRepository;
    private final UserRepository userRepository;
    private final Clock clock;

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
            return QuotaReservation.unlimited();
        }

        LocalDate periodStart = currentQuotaPeriod();
        int updated = userRepository.reserveFreeGeneration(
                user.getId(), periodStart, FREE_PLAN_LIMIT);
        if (updated == 0) {
            throw new QuotaExceededException();
        }
        return QuotaReservation.free(periodStart);
    }

    @Transactional
    public void releaseGeneration(Long userId, QuotaReservation reservation) {
        if (reservation != null && reservation.consumesFreeQuota()) {
            userRepository.releaseFreeGeneration(userId, reservation.periodStart());
        }
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
        try {
            // Extract IDs from raw JSON to avoid SDK/API version deserialization mismatch
            com.fasterxml.jackson.databind.JsonNode obj = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(event.toJson())
                    .path("data").path("object");

            String customerId = obj.path("customer").asText(null);
            String subscriptionId = obj.path("subscription").asText(null);
            if ("null".equals(customerId)) customerId = null;
            if ("null".equals(subscriptionId)) subscriptionId = null;

            if (subscriptionId == null || customerId == null) {
                log.warn("checkout.session.completed missing subscription or customer id");
                return;
            }

            // Retrieve full subscription details from Stripe
            com.stripe.model.Subscription stripeSub =
                    com.stripe.model.Subscription.retrieve(subscriptionId);

            // Find the user by Stripe customer ID (set during checkout creation)
            Optional<User> userOpt = userRepository.findByStripeCustomerId(customerId);
            if (userOpt.isEmpty()) {
                log.warn("No user found for Stripe customer {}", customerId);
                return;
            }

            User user = userOpt.get();

            // Upsert subscription row
            Subscription sub = subscriptionRepository.findByUserId(user.getId())
                    .orElse(new Subscription());
            sub.setUser(user);
            sub.setStripeSubscriptionId(stripeSub.getId());
            sub.setStripeCustomerId(customerId);
            sub.setStatus(stripeSub.getStatus());
            sub.setTier("PRO");
            applyPeriod(sub, stripeSub);
            sub.setCancelAtPeriodEnd(Boolean.TRUE.equals(stripeSub.getCancelAtPeriodEnd()));
            subscriptionRepository.save(sub);

            // Persist customer ID on user entity
            user.setStripeCustomerId(customerId);
            userRepository.save(user);

        } catch (Exception e) {
            log.error("Error handling checkout.session.completed", e);
        }
    }

    @Transactional
    public void handleSubscriptionUpdated(Event event) {
        Stripe.apiKey = stripeSecretKey;
        try {
            String subscriptionId = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(event.toJson())
                    .path("data").path("object").path("id").asText();

            com.stripe.model.Subscription stripeSub = com.stripe.model.Subscription.retrieve(subscriptionId);

            subscriptionRepository.findByStripeSubscriptionId(stripeSub.getId())
                    .ifPresent(sub -> {
                        sub.setStatus(stripeSub.getStatus());
                        applyPeriod(sub, stripeSub);
                        sub.setCancelAtPeriodEnd(Boolean.TRUE.equals(stripeSub.getCancelAtPeriodEnd()));
                        subscriptionRepository.save(sub);
                    });
        } catch (Exception e) {
            log.error("Error handling customer.subscription.updated", e);
        }
    }

    @Transactional
    public void handleSubscriptionDeleted(Event event) {
        Stripe.apiKey = stripeSecretKey;
        try {
            String subscriptionId = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(event.toJson())
                    .path("data").path("object").path("id").asText();

            subscriptionRepository.findByStripeSubscriptionId(subscriptionId)
                    .ifPresent(sub -> {
                        sub.setStatus("canceled");
                        subscriptionRepository.save(sub);
                    });
        } catch (Exception e) {
            log.error("Error handling customer.subscription.deleted", e);
        }
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
