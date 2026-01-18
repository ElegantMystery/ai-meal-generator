package com.mealgen.backend.auth.service;

import com.mealgen.backend.auth.dto.AuthResponse;
import com.mealgen.backend.auth.dto.LoginRequest;
import com.mealgen.backend.auth.dto.SignupRequest;
import com.mealgen.backend.auth.exception.EmailAlreadyExistsException;
import com.mealgen.backend.auth.exception.InvalidCredentialsException;
import com.mealgen.backend.auth.exception.OAuthUserLoginException;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private static final Logger logger = LoggerFactory.getLogger(AuthService.class);

    private static final String LOCAL_PROVIDER = "local";

    @Transactional
    public AuthResponse signup(SignupRequest request) {
        // Check if email already exists
        if (userRepository.findByEmail(request.getEmail()).isPresent()) {
            throw new EmailAlreadyExistsException("An account with this email already exists");
        }

        // Create new local user
        User user = User.builder()
                .email(request.getEmail())
                .name(request.getName())
                .provider(LOCAL_PROVIDER)
                .passwordHash(passwordEncoder.encode(request.getPassword()))
                .build();

        User savedUser = userRepository.save(user);
        logger.info("New local user created: {}", savedUser.getEmail());

        return toAuthResponse(savedUser);
    }

    public AuthResponse login(LoginRequest request) {
        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new InvalidCredentialsException("Invalid email or password"));

        // Check if user is OAuth-only (no password set)
        if (user.getPasswordHash() == null) {
            String provider = user.getProvider() != null ? user.getProvider() : "OAuth";
            throw new OAuthUserLoginException(
                "This account uses " + provider + " sign-in. Please use the '" +
                provider + "' button to log in."
            );
        }

        // Verify password
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            throw new InvalidCredentialsException("Invalid email or password");
        }

        logger.info("Local user logged in: {}", user.getEmail());
        return toAuthResponse(user);
    }

    public AuthResponse getUserByEmail(String email) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found"));
        return toAuthResponse(user);
    }

    private AuthResponse toAuthResponse(User user) {
        return AuthResponse.builder()
                .id(user.getId())
                .email(user.getEmail())
                .name(user.getName())
                .provider(user.getProvider())
                .build();
    }
}
