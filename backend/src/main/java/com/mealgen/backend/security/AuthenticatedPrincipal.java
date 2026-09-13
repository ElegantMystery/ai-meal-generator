package com.mealgen.backend.security;

import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;

/** Shared extraction and validation for controller authentication principals. */
public final class AuthenticatedPrincipal {

    private AuthenticatedPrincipal() {
    }

    public static String email(Authentication authentication) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            throw new IllegalStateException("Not authenticated");
        }

        Object principal = authentication.getPrincipal();
        if (principal instanceof OAuth2User oauth2User) {
            Object value = oauth2User.getAttributes().get("email");
            if (!(value instanceof String email) || email.isBlank()) {
                throw new IllegalStateException("OAuth2 principal has invalid email");
            }
            return email;
        }

        // Retained for controller-level authenticated test principals.
        if (principal instanceof String email
                && !email.isBlank()
                && !"anonymousUser".equals(email)) {
            return email;
        }

        throw new IllegalStateException("Invalid authenticated principal");
    }
}
