package com.mealgen.backend.subscription.exception;

public class QuotaExceededException extends RuntimeException {
    public QuotaExceededException() {
        super("Free plan limit reached. Upgrade to Pro for unlimited meal plans.");
    }
}
