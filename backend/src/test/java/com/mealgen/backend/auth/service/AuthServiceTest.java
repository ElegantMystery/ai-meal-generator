package com.mealgen.backend.auth.service;

import com.mealgen.backend.auth.dto.AuthResponse;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private AuthService authService;

    @Test
    void getUserByEmail_returnsAuthResponse() {
        User user = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("google").providerId("sub123").build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(user));

        AuthResponse result = authService.getUserByEmail("alice@example.com");

        assertThat(result.getId()).isEqualTo(1L);
        assertThat(result.getEmail()).isEqualTo("alice@example.com");
        assertThat(result.getName()).isEqualTo("Alice");
        assertThat(result.getProvider()).isEqualTo("google");
    }

    @Test
    void getUserByEmail_throwsWhenNotFound() {
        when(userRepository.findByEmail("unknown@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.getUserByEmail("unknown@example.com"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("User not found");
    }

    @Test
    void completeOnboarding_setsFlag() {
        User user = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("google").onboardingCompleted(false).build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(user));
        when(userRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        authService.completeOnboarding("alice@example.com");

        assertThat(user.isOnboardingCompleted()).isTrue();
    }

    @Test
    void completeOnboarding_throwsWhenNotFound() {
        when(userRepository.findByEmail("unknown@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.completeOnboarding("unknown@example.com"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("User not found");
    }
}
