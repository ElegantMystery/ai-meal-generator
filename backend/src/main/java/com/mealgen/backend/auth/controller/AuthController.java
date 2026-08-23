package com.mealgen.backend.auth.controller;

import com.mealgen.backend.auth.dto.AuthResponse;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.auth.service.AuthService;
import com.mealgen.backend.subscription.service.SubscriptionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final UserRepository userRepository;
    private final AuthService authService;
    private final SubscriptionService subscriptionService;
    private static final Logger logger = LoggerFactory.getLogger(AuthController.class);

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken csrfToken) {
        return Map.of("headerName", csrfToken.getHeaderName(), "token", csrfToken.getToken());
    }

    @GetMapping("/me")
    public ResponseEntity<?> getCurrentUser(
            @AuthenticationPrincipal OAuth2User oauth2User,
            HttpServletRequest request
    ) {
        if (oauth2User == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));
        }

        String providerId = oauth2User.getName();
        Optional<User> userOpt = userRepository.findByProviderId(providerId);

        if (userOpt.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "User not found"));
        }

        User user = userOpt.get();
        return ResponseEntity.ok(Map.of(
                "id", user.getId().toString(),
                "email", user.getEmail(),
                "name", user.getName() != null ? user.getName() : "",
                "provider", user.getProvider() != null ? user.getProvider() : "",
                "providerId", user.getProviderId() != null ? user.getProviderId() : "",
                "onboardingCompleted", user.isOnboardingCompleted(),
                "tier", subscriptionService.getTier(user.getId()).name(),
                "remainingQuota", subscriptionService.getRemainingQuota(user)
        ));
    }

    @PostMapping("/complete-onboarding")
    public ResponseEntity<?> completeOnboarding(
            @AuthenticationPrincipal OAuth2User oauth2User
    ) {
        if (oauth2User == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));
        }

        String providerId = oauth2User.getName();
        Optional<User> userOpt = userRepository.findByProviderId(providerId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "User not found"));
        }

        try {
            authService.completeOnboarding(userOpt.get().getEmail());
            return ResponseEntity.ok(Map.of("message", "Onboarding completed"));
        } catch (Exception e) {
            logger.error("Error completing onboarding", e);
            return ResponseEntity.status(500).body(Map.of("error", "Failed to complete onboarding"));
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout(HttpServletRequest request, HttpServletResponse response) {
        try {
            HttpSession session = request.getSession(false);
            if (session != null) {
                session.invalidate();
                logger.info("Session invalidated successfully");
            }
            SecurityContextHolder.clearContext();
            return ResponseEntity.ok(Map.of("message", "Logged out successfully"));
        } catch (Exception e) {
            logger.error("Error during logout", e);
            return ResponseEntity.status(500).body(Map.of("error", "Logout failed"));
        }
    }
}
