package com.mealgen.backend.auth.exception;

/** Expected lookup failure that authentication endpoints may safely classify. */
public final class AuthUserNotFoundException extends IllegalStateException {

    public AuthUserNotFoundException() {
        super("User not found");
    }
}
