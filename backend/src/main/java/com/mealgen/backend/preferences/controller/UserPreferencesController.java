package com.mealgen.backend.preferences.controller;

import com.mealgen.backend.preferences.dto.UserPreferencesDto;
import com.mealgen.backend.preferences.service.UserPreferencesService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/preferences")
@RequiredArgsConstructor
public class UserPreferencesController {

    private final UserPreferencesService preferencesService;

    @GetMapping("/me")
    public UserPreferencesDto getMyPreferences(Authentication authentication) {
        String email = getEmail(authentication);
        return preferencesService.getMyPreferences(email);
    }

    @PutMapping("/me")
    public UserPreferencesDto upsertMyPreferences(
            Authentication authentication,
            @RequestBody UserPreferencesDto dto
    ) {
        String email = getEmail(authentication);
        return preferencesService.upsertMyPreferences(email, dto);
    }

    private String getEmail(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new IllegalStateException("Not authenticated");
        }

        Object principal = authentication.getPrincipal();

        // Handle OAuth2 users (Google login)
        if (principal instanceof OAuth2User oauth2User) {
            Object email = oauth2User.getAttributes().get("email");
            if (email == null) throw new IllegalStateException("OAuth2 principal missing email");
            return email.toString();
        }

        // Handle local users (email/password login) - principal is the email string
        if (principal instanceof String email) {
            return email;
        }

        throw new IllegalStateException("Unknown principal type: " + principal.getClass());
    }
}
