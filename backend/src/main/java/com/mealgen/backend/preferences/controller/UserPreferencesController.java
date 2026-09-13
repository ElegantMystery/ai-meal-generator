package com.mealgen.backend.preferences.controller;

import com.mealgen.backend.preferences.dto.UserPreferencesDto;
import com.mealgen.backend.preferences.service.UserPreferencesService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import static com.mealgen.backend.security.AuthenticatedPrincipal.email;

@RestController
@RequestMapping("/api/preferences")
@RequiredArgsConstructor
public class UserPreferencesController {

    private final UserPreferencesService preferencesService;

    @GetMapping("/me")
    public UserPreferencesDto getMyPreferences(Authentication authentication) {
        return preferencesService.getMyPreferences(email(authentication));
    }

    @PutMapping("/me")
    public UserPreferencesDto upsertMyPreferences(
            Authentication authentication,
            @RequestBody UserPreferencesDto dto
    ) {
        return preferencesService.upsertMyPreferences(email(authentication), dto);
    }
}
