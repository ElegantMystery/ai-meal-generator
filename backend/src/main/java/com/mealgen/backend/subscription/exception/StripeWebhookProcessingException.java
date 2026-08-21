package com.mealgen.backend.subscription.exception;

/** A retryable failure while applying an already signature-verified Stripe event. */
public class StripeWebhookProcessingException extends RuntimeException {
    public StripeWebhookProcessingException(String message) {
        super(message);
    }

    public StripeWebhookProcessingException(String message, Throwable cause) {
        super(message, cause);
    }
}
