package com.mealgen.backend.auth.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.mealgen.backend.auth.dto.LoginRequest;
import com.mealgen.backend.auth.dto.SignupRequest;
import com.mealgen.backend.auth.exception.InvalidCredentialsException;
import com.mealgen.backend.auth.exception.OAuthUserLoginException;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @InjectMocks
    private AuthService authService;

    private ListAppender<ILoggingEvent> listAppender;
    private Logger authServiceLogger;

    @BeforeEach
    void setUp() {
        authServiceLogger = (Logger) LoggerFactory.getLogger(AuthService.class);
        listAppender = new ListAppender<>();
        listAppender.start();
        authServiceLogger.addAppender(listAppender);
        MDC.clear();
    }

    @AfterEach
    void tearDown() {
        authServiceLogger.detachAppender(listAppender);
        MDC.clear();
    }

    // -------------------------------------------------------------------------
    // signup()
    // -------------------------------------------------------------------------

    @Test
    void signup_success_setsMdcEventAndProvider() {
        SignupRequest request = SignupRequest.builder()
                .email("alice@example.com").name("Alice").password("password123").build();
        User savedUser = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("local").passwordHash("hashed").build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode(anyString())).thenReturn("hashed");
        when(userRepository.save(any())).thenReturn(savedUser);

        authService.signup(request);

        ILoggingEvent event = findLogEvent("New local user created");
        assertThat(event.getMDCPropertyMap())
                .containsEntry("event", "SIGNUP_SUCCESS")
                .containsEntry("provider", "local");
    }

    @Test
    void signup_success_clearsMdcAfterLogging() {
        SignupRequest request = SignupRequest.builder()
                .email("alice@example.com").name("Alice").password("password123").build();
        User savedUser = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("local").passwordHash("hashed").build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode(anyString())).thenReturn("hashed");
        when(userRepository.save(any())).thenReturn(savedUser);

        authService.signup(request);

        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
    }

    // -------------------------------------------------------------------------
    // login() — success
    // -------------------------------------------------------------------------

    @Test
    void login_success_setsMdcEventAndProvider() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com").password("password123").build();
        User user = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("local").passwordHash("hashed").build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("password123", "hashed")).thenReturn(true);

        authService.login(request);

        ILoggingEvent event = findLogEvent("Local user logged in");
        assertThat(event.getMDCPropertyMap())
                .containsEntry("event", "LOGIN_SUCCESS")
                .containsEntry("provider", "local");
    }

    @Test
    void login_success_clearsMdcAfterLogging() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com").password("password123").build();
        User user = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("local").passwordHash("hashed").build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("password123", "hashed")).thenReturn(true);

        authService.login(request);

        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
    }

    // -------------------------------------------------------------------------
    // login() — wrong password
    // -------------------------------------------------------------------------

    @Test
    void login_wrongPassword_setsLoginFailedMdc() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com").password("wrongpassword").build();
        User user = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("local").passwordHash("hashed").build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("wrongpassword", "hashed")).thenReturn(false);

        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(InvalidCredentialsException.class);

        ILoggingEvent event = findLogEvent("Failed login attempt");
        assertThat(event.getMDCPropertyMap())
                .containsEntry("event", "LOGIN_FAILED")
                .containsEntry("provider", "local");
    }

    @Test
    void login_wrongPassword_clearsMdcAfterLogging() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com").password("wrongpassword").build();
        User user = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("local").passwordHash("hashed").build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("wrongpassword", "hashed")).thenReturn(false);

        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(InvalidCredentialsException.class);

        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
    }

    // -------------------------------------------------------------------------
    // login() — OAuth-only user attempting local login
    // -------------------------------------------------------------------------

    @Test
    void login_oauthOnlyUser_setsLoginFailedMdcWithOauthProvider() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com").password("anypassword").build();
        User user = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("google").passwordHash(null).build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(OAuthUserLoginException.class);

        ILoggingEvent event = findLogEvent("OAuth-only user attempted local login");
        assertThat(event.getMDCPropertyMap())
                .containsEntry("event", "LOGIN_FAILED")
                .containsEntry("provider", "google");
    }

    @Test
    void login_oauthOnlyUser_clearsMdcAfterLogging() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com").password("anypassword").build();
        User user = User.builder()
                .id(1L).email("alice@example.com").name("Alice")
                .provider("google").passwordHash(null).build();

        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(OAuthUserLoginException.class);

        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
    }

    // -------------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------------

    private ILoggingEvent findLogEvent(String messageSubstring) {
        return listAppender.list.stream()
                .filter(e -> e.getFormattedMessage().contains(messageSubstring))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "No log event found containing: '" + messageSubstring + "'\n" +
                        "Captured events: " + listAppender.list.stream()
                                .map(ILoggingEvent::getFormattedMessage).toList()));
    }
}
