package com.mealgen.backend.auth.controller;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.auth.service.AuthService;
import com.mealgen.backend.subscription.service.SubscriptionService;
import com.mealgen.backend.subscription.model.SubscriptionTier;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.core.user.OAuth2User;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthControllerTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private AuthService authService;

    @Mock
    private SubscriptionService subscriptionService;

    @InjectMocks
    private AuthController authController;

    @Test
    void getCurrentUser_returnsUserDataForAuthenticatedOAuth2User() {
        OAuth2User oauth2User = mock(OAuth2User.class);
        when(oauth2User.getName()).thenReturn("sub123");

        User user = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("google").providerId("sub123").onboardingCompleted(true).build();

        when(userRepository.findByProviderId("sub123")).thenReturn(Optional.of(user));
        when(subscriptionService.getTier(1L)).thenReturn(SubscriptionTier.FREE);
        when(subscriptionService.getRemainingQuota(user)).thenReturn(3);

        ResponseEntity<?> response = authController.getCurrentUser(oauth2User, mock(HttpServletRequest.class));

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        assertThat(body).containsEntry("email", "alice@example.com");
        assertThat(body).containsEntry("tier", "FREE");
        assertThat(body).containsEntry("remainingQuota", 3);
    }

    @Test
    void getCurrentUser_returns401WhenNotAuthenticated() {
        ResponseEntity<?> response = authController.getCurrentUser(null, mock(HttpServletRequest.class));

        assertThat(response.getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void getCurrentUser_returns404WhenUserNotInDb() {
        OAuth2User oauth2User = mock(OAuth2User.class);
        when(oauth2User.getName()).thenReturn("sub999");
        when(userRepository.findByProviderId("sub999")).thenReturn(Optional.empty());

        ResponseEntity<?> response = authController.getCurrentUser(oauth2User, mock(HttpServletRequest.class));

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void logout_invalidatesSessionAndReturnsOk() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpSession session = mock(HttpSession.class);
        when(request.getSession(false)).thenReturn(session);

        ResponseEntity<?> response = authController.logout(request, mock(HttpServletResponse.class));

        verify(session).invalidate();
        assertThat(response.getStatusCode().value()).isEqualTo(200);
    }
}
