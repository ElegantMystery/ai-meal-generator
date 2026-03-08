package com.mealgen.backend.subscription.controller;

import com.mealgen.backend.subscription.service.SubscriptionService;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import com.stripe.net.Webhook;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/webhooks")
@RequiredArgsConstructor
public class StripeWebhookController {

    private static final Logger log = LoggerFactory.getLogger(StripeWebhookController.class);

    private final SubscriptionService subscriptionService;

    @Value("${stripe.webhook-secret}")
    String webhookSecret;

    @PostMapping(value = "/stripe", consumes = "application/json")
    public ResponseEntity<?> handleWebhook(
            @RequestBody String payload,
            @RequestHeader(value = "Stripe-Signature", required = false) String sigHeader
    ) {
        // Validate signature header is present
        if (sigHeader == null || sigHeader.isBlank()) {
            log.warn("Stripe webhook received without Stripe-Signature header");
            return ResponseEntity.badRequest().body("Missing Stripe-Signature header");
        }

        // Verify webhook signature
        Event event;
        try {
            event = Webhook.constructEvent(payload, sigHeader, webhookSecret);
        } catch (SignatureVerificationException e) {
            log.warn("Invalid Stripe webhook signature: {}", e.getMessage());
            return ResponseEntity.badRequest().body("Invalid signature");
        }

        // Dispatch based on event type
        switch (event.getType()) {
            case "checkout.session.completed" ->
                subscriptionService.handleCheckoutCompleted(event);
            case "customer.subscription.updated" ->
                subscriptionService.handleSubscriptionUpdated(event);
            case "customer.subscription.deleted" ->
                subscriptionService.handleSubscriptionDeleted(event);
            default ->
                log.debug("Unhandled Stripe event type: {}", event.getType());
        }

        // Always return 200 (Stripe best practice)
        return ResponseEntity.ok().build();
    }
}
