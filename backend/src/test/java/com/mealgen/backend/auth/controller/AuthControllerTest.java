package com.mealgen.backend.auth.controller;

import com.mealgen.backend.auth.dto.AuthResponse;
import com.mealgen.backend.auth.dto.LoginRequest;
import com.mealgen.backend.auth.dto.SignupRequest;
import com.mealgen.backend.auth.exception.InvalidCredentialsException;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.auth.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.MDC;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests verifying that AuthController correctly populates and clears
 * the MDC "sourceIp" field around calls to AuthService.
 *
 * Uses pure Mockito (no Spring context) for speed and isolation.
 */
@ExtendWith(MockitoExtension.class)
class AuthControllerTest {

    @Mock
    private AuthService authService;

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private AuthController authController;

    @AfterEach
    void tearDown() {
        MDC.clear();
    }

    // -------------------------------------------------------------------------
    // POST /api/auth/signup — sourceIp MDC
    // -------------------------------------------------------------------------

    @Test
    void signup_populatesSourceIpMdcBeforeCallingService() {
        HttpServletRequest httpRequest = mockHttpRequest("203.0.113.1");
        AuthResponse mockResponse = buildAuthResponse();

        AtomicReference<String> capturedIp = new AtomicReference<>();
        doAnswer(inv -> {
            capturedIp.set(MDC.get("sourceIp"));
            return mockResponse;
        }).when(authService).signup(any(SignupRequest.class));

        authController.signup(buildSignupRequest(), httpRequest);

        assertThat(capturedIp.get())
                .as("sourceIp MDC should equal the request remote address at call time")
                .isEqualTo("203.0.113.1");
    }

    @Test
    void signup_removesSourceIpMdcAfterSuccessfulCall() {
        HttpServletRequest httpRequest = mockHttpRequest("203.0.113.1");
        when(authService.signup(any())).thenReturn(buildAuthResponse());

        authController.signup(buildSignupRequest(), httpRequest);

        assertThat(MDC.get("sourceIp"))
                .as("sourceIp MDC should be removed after request completes")
                .isNull();
    }

    @Test
    void signup_removesSourceIpMdcEvenWhenServiceThrows() {
        HttpServletRequest httpRequest = mock(HttpServletRequest.class);
        when(httpRequest.getHeader("X-Forwarded-For")).thenReturn(null);
        when(httpRequest.getRemoteAddr()).thenReturn("203.0.113.1");
        when(authService.signup(any())).thenThrow(new InvalidCredentialsException("boom"));

        try {
            authController.signup(buildSignupRequest(), httpRequest);
        } catch (Exception ignored) {
            // expected
        }

        assertThat(MDC.get("sourceIp"))
                .as("sourceIp MDC must be cleaned up even on exception (finally block)")
                .isNull();
    }

    // -------------------------------------------------------------------------
    // POST /api/auth/login — sourceIp MDC
    // -------------------------------------------------------------------------

    @Test
    void login_populatesSourceIpMdcBeforeCallingService() {
        HttpServletRequest httpRequest = mockHttpRequest("10.0.0.42");
        AuthResponse mockResponse = buildAuthResponse();

        AtomicReference<String> capturedIp = new AtomicReference<>();
        doAnswer(inv -> {
            capturedIp.set(MDC.get("sourceIp"));
            return mockResponse;
        }).when(authService).login(any(LoginRequest.class));

        authController.login(buildLoginRequest(), httpRequest);

        assertThat(capturedIp.get())
                .as("sourceIp MDC should equal the request remote address at call time")
                .isEqualTo("10.0.0.42");
    }

    @Test
    void login_removesSourceIpMdcAfterSuccessfulCall() {
        HttpServletRequest httpRequest = mockHttpRequest("10.0.0.42");
        when(authService.login(any())).thenReturn(buildAuthResponse());

        authController.login(buildLoginRequest(), httpRequest);

        assertThat(MDC.get("sourceIp"))
                .as("sourceIp MDC should be removed after request completes")
                .isNull();
    }

    @Test
    void login_removesSourceIpMdcEvenWhenServiceThrows() {
        HttpServletRequest httpRequest = mock(HttpServletRequest.class);
        when(httpRequest.getHeader("X-Forwarded-For")).thenReturn(null);
        when(httpRequest.getRemoteAddr()).thenReturn("10.0.0.42");
        when(authService.login(any())).thenThrow(new InvalidCredentialsException("bad creds"));

        try {
            authController.login(buildLoginRequest(), httpRequest);
        } catch (Exception ignored) {
            // expected
        }

        assertThat(MDC.get("sourceIp"))
                .as("sourceIp MDC must be cleaned up even on exception (finally block)")
                .isNull();
    }

    // -------------------------------------------------------------------------
    // X-Forwarded-For — primary production path (behind nginx)
    // -------------------------------------------------------------------------

    @Test
    void signup_usesXForwardedForHeaderOverRemoteAddr() {
        HttpServletRequest httpRequest = mockHttpRequestWithXff("10.1.2.3", "172.18.0.2");
        AuthResponse mockResponse = buildAuthResponse();

        AtomicReference<String> capturedIp = new AtomicReference<>();
        doAnswer(inv -> {
            capturedIp.set(MDC.get("sourceIp"));
            return mockResponse;
        }).when(authService).signup(any(SignupRequest.class));

        authController.signup(buildSignupRequest(), httpRequest);

        assertThat(capturedIp.get())
                .as("X-Forwarded-For should take priority over getRemoteAddr()")
                .isEqualTo("10.1.2.3");
    }

    @Test
    void signup_takesFirstIpWhenXForwardedForIsMultiValue() {
        HttpServletRequest httpRequest = mockHttpRequestWithXff("203.0.113.5, 10.0.0.1", "172.18.0.2");
        AuthResponse mockResponse = buildAuthResponse();

        AtomicReference<String> capturedIp = new AtomicReference<>();
        doAnswer(inv -> {
            capturedIp.set(MDC.get("sourceIp"));
            return mockResponse;
        }).when(authService).signup(any(SignupRequest.class));

        authController.signup(buildSignupRequest(), httpRequest);

        assertThat(capturedIp.get())
                .as("Only the first (client-originated) IP should be taken from XFF chain")
                .isEqualTo("203.0.113.5");
    }

    @Test
    void login_usesXForwardedForHeaderOverRemoteAddr() {
        HttpServletRequest httpRequest = mockHttpRequestWithXff("10.1.2.3", "172.18.0.2");
        AuthResponse mockResponse = buildAuthResponse();

        AtomicReference<String> capturedIp = new AtomicReference<>();
        doAnswer(inv -> {
            capturedIp.set(MDC.get("sourceIp"));
            return mockResponse;
        }).when(authService).login(any(LoginRequest.class));

        authController.login(buildLoginRequest(), httpRequest);

        assertThat(capturedIp.get())
                .as("X-Forwarded-For should take priority over getRemoteAddr()")
                .isEqualTo("10.1.2.3");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /** Simulates request arriving directly (no reverse proxy). Falls back to getRemoteAddr(). */
    private HttpServletRequest mockHttpRequest(String remoteAddr) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpSession session = mock(HttpSession.class);
        when(request.getHeader("X-Forwarded-For")).thenReturn(null);
        when(request.getRemoteAddr()).thenReturn(remoteAddr);
        when(request.getSession(true)).thenReturn(session);
        return request;
    }

    /** Simulates request arriving via nginx with X-Forwarded-For header set. */
    private HttpServletRequest mockHttpRequestWithXff(String xff, String remoteAddr) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpSession session = mock(HttpSession.class);
        when(request.getHeader("X-Forwarded-For")).thenReturn(xff);
        when(request.getSession(true)).thenReturn(session);
        lenient().when(request.getRemoteAddr()).thenReturn(remoteAddr);
        return request;
    }

    private SignupRequest buildSignupRequest() {
        return SignupRequest.builder()
                .email("alice@example.com").name("Alice").password("password123").build();
    }

    private LoginRequest buildLoginRequest() {
        return LoginRequest.builder()
                .email("alice@example.com").password("password123").build();
    }

    private AuthResponse buildAuthResponse() {
        return AuthResponse.builder()
                .id(1L).email("alice@example.com").name("Alice").provider("local").build();
    }
}
