package com.mealgen.backend.auth.controller;

import com.mealgen.backend.auth.dto.AuthResponse;
import com.mealgen.backend.auth.dto.LoginRequest;
import com.mealgen.backend.auth.dto.SignupRequest;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.auth.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final UserRepository userRepository;
    private final AuthService authService;
    private static final Logger logger = LoggerFactory.getLogger(AuthController.class);

    @PostMapping("/signup")
    public ResponseEntity<?> signup(
            @Valid @RequestBody SignupRequest request,
            HttpServletRequest httpRequest
    ) {
        AuthResponse response = authService.signup(request);
        setSecurityContext(response, httpRequest);
        return ResponseEntity.ok(Map.of("user", response));
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest
    ) {
        AuthResponse response = authService.login(request);
        setSecurityContext(response, httpRequest);
        return ResponseEntity.ok(Map.of("user", response));
    }

    private void setSecurityContext(AuthResponse user, HttpServletRequest request) {
        // Create authentication token
        UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                user.getEmail(),
                null,
                List.of(new SimpleGrantedAuthority("ROLE_USER"))
        );

        // Set the security context
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);

        // Store in session so it persists across requests
        HttpSession session = request.getSession(true);
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        session.setAttribute("userId", user.getId());
        session.setAttribute("userEmail", user.getEmail());
    }

    @GetMapping("/me")
    public ResponseEntity<?> getCurrentUser(
            @AuthenticationPrincipal OAuth2User oauth2User,
            HttpServletRequest request
    ) {
        // First check OAuth2 authentication
        if (oauth2User != null) {
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
                    "providerId", user.getProviderId() != null ? user.getProviderId() : ""
            ));
        }

        // Check session-based authentication (local users)
        HttpSession session = request.getSession(false);
        if (session != null) {
            // Check for Spring Security context in session
            SecurityContext securityContext = (SecurityContext) session.getAttribute(
                    HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
            if (securityContext != null && securityContext.getAuthentication() != null
                    && securityContext.getAuthentication().isAuthenticated()) {
                String email = (String) securityContext.getAuthentication().getPrincipal();
                try {
                    AuthResponse response = authService.getUserByEmail(email);
                    return ResponseEntity.ok(Map.of(
                            "id", response.getId().toString(),
                            "email", response.getEmail(),
                            "name", response.getName() != null ? response.getName() : "",
                            "provider", response.getProvider() != null ? response.getProvider() : "",
                            "providerId", ""
                    ));
                } catch (Exception e) {
                    logger.error("Error fetching user from session", e);
                }
            }
        }

        return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout(HttpServletRequest request, HttpServletResponse response) {
        try {
            // Invalidate the session
            HttpSession session = request.getSession(false);
            if (session != null) {
                session.invalidate();
                logger.info("Session invalidated successfully");
            }

            // Clear the security context
            SecurityContextHolder.clearContext();

            // Clear any cookies if needed (Spring Security handles this via logout handler)
            return ResponseEntity.ok(Map.of("message", "Logged out successfully"));
        } catch (Exception e) {
            logger.error("Error during logout", e);
            return ResponseEntity.status(500).body(Map.of("error", "Logout failed"));
        }
    }
}
