package com.mealgen.backend.preferences.controller;

import com.mealgen.backend.preferences.dto.UserPreferencesDto;
import com.mealgen.backend.preferences.service.UserPreferencesService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/preferences")
@RequiredArgsConstructor
public class UserPreferencesController {

    private final UserPreferencesService preferencesService;

    @GetMapping("/me")
    public UserPreferencesDto getMyPreferences(@AuthenticationPrincipal OAuth2User principal) {
        String email = getEmail(principal);
        return preferencesService.getMyPreferences(email);
    }

    @PutMapping("/me")
    public UserPreferencesDto upsertMyPreferences(
            @AuthenticationPrincipal OAuth2User principal,
            @RequestBody UserPreferencesDto dto
    ) {
        String email = getEmail(principal);
        return preferencesService.upsertMyPreferences(email, dto);
    }

    private String getEmail(OAuth2User principal) {
        if (principal == null) {
            // Should be handled by security (401), but just in case
            throw new IllegalStateException("Not authenticated");
        }
        Object emailObj = principal.getAttributes().get("email");
        if (emailObj == null) {
            throw new IllegalStateException("OAuth2 principal has no email attribute");
        }
        return emailObj.toString();
    }
}
