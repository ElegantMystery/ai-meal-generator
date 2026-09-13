package com.mealgen.backend.preferences.service;

import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.preferences.dto.UserPreferencesDto;
import com.mealgen.backend.preferences.repository.UserPreferencesRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class UserPreferencesServiceTest {

    private UserRepository userRepository;
    private UserPreferencesService service;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        service = new UserPreferencesService(
                userRepository, mock(UserPreferencesRepository.class));
    }

    @Test
    void getPreferences_missingUserDoesNotExposeEmail() {
        String email = "sensitive@example.com";
        when(userRepository.findByEmail(email)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getMyPreferences(email))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasMessage("User not found")
                .hasMessageNotContaining(email);
    }

    @Test
    void upsertPreferences_missingUserDoesNotExposeEmail() {
        String email = "sensitive@example.com";
        when(userRepository.findByEmail(email)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.upsertMyPreferences(
                email, UserPreferencesDto.builder().build()))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasMessage("User not found")
                .hasMessageNotContaining(email);
    }
}
