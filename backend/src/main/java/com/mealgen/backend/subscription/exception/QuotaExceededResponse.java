package com.mealgen.backend.subscription.exception;

public record QuotaExceededResponse(String error, String message) {}
