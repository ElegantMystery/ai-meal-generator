package com.mealgen.backend.subscription.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class SubscriptionExceptionHandler {

    @ExceptionHandler(QuotaExceededException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public QuotaExceededResponse handleQuotaExceeded(QuotaExceededException ex) {
        return new QuotaExceededResponse("QUOTA_EXCEEDED", ex.getMessage());
    }
}
