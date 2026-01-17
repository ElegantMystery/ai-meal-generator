package com.mealgen.backend.preferences.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.preferences.dto.UserPreferencesDto;
import com.mealgen.backend.preferences.model.UserPreferences;
import com.mealgen.backend.preferences.repository.UserPreferencesRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserPreferencesService {

    private final UserRepository userRepository;
    private final UserPreferencesRepository preferencesRepository;

    public UserPreferencesDto getMyPreferences(String email) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found for email: " + email));

        return preferencesRepository.findByUserId(user.getId())
                .map(this::toDto)
                .orElse(null); // return null if not set yet (frontend shows placeholder)
    }

    @Transactional
    public UserPreferencesDto upsertMyPreferences(String email, UserPreferencesDto dto) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found for email: " + email));

        UserPreferences prefs = preferencesRepository.findByUserId(user.getId())
                .orElseGet(() -> UserPreferences.builder().user(user).build());

        prefs.setDietaryRestrictions(normalize(dto.getDietaryRestrictions()));
        prefs.setAllergies(normalize(dto.getAllergies()));
        prefs.setTargetCaloriesPerDay(dto.getTargetCaloriesPerDay());

        UserPreferences saved = preferencesRepository.save(prefs);
        return toDto(saved);
    }

    private UserPreferencesDto toDto(UserPreferences p) {
        return UserPreferencesDto.builder()
                .dietaryRestrictions(p.getDietaryRestrictions())
                .allergies(p.getAllergies())
                .targetCaloriesPerDay(p.getTargetCaloriesPerDay())
                .build();
    }

    private String normalize(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
