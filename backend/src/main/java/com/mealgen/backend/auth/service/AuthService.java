package com.mealgen.backend.auth.service;

import com.mealgen.backend.auth.dto.AuthResponse;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private static final Logger logger = LoggerFactory.getLogger(AuthService.class);

    public AuthResponse getUserByEmail(String email) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found"));
        return toAuthResponse(user);
    }

    @Transactional
    public void completeOnboarding(String email) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found"));
        user.setOnboardingCompleted(true);
        userRepository.save(user);
        logger.info("User completed onboarding: id={}", user.getId());
    }

    private AuthResponse toAuthResponse(User user) {
        return AuthResponse.builder()
                .id(user.getId())
                .email(user.getEmail())
                .name(user.getName())
                .provider(user.getProvider())
                .onboardingCompleted(user.isOnboardingCompleted())
                .build();
    }
}
