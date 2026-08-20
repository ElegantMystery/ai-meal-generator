package com.mealgen.backend.subscription.controller;

import com.mealgen.backend.subscription.service.StripeWebhookService;
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

    private final StripeWebhookService stripeWebhookService;

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

        // Processing failures intentionally propagate as 5xx so Stripe retries.
        stripeWebhookService.process(event);

        return ResponseEntity.ok().build();
    }
}
