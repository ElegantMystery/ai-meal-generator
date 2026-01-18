package com.mealgen.backend.auth.exception;

public class OAuthUserLoginException extends RuntimeException {
    public OAuthUserLoginException(String message) {
        super(message);
    }
}
