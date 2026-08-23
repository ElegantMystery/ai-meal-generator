package com.mealgen.backend.security;

import com.mealgen.backend.auth.service.CustomOAuth2UserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = SecurityConfigTest.TestController.class,
        properties = {"cors.allowed-origins=https://whole-haul.com", "frontend.url=https://whole-haul.com",
                "csrf.cookie-secure=true"})
@Import(SecurityConfig.class)
class SecurityConfigTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    CustomOAuth2UserService customOAuth2UserService;

    @MockitoBean
    ClientRegistrationRepository clientRegistrationRepository;

    @Test
    @WithMockUser
    void rejectsAuthenticatedMutationWithoutCsrfToken() throws Exception {
        mockMvc.perform(post("/test/mutate"))
                .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser
    void acceptsAuthenticatedMutationWithCsrfToken() throws Exception {
        mockMvc.perform(post("/test/mutate").with(csrf()))
                .andExpect(status().isNotFound());
    }

    @Test
    void stripeWebhookIsTheOnlyMutationExemptFromCsrf() throws Exception {
        mockMvc.perform(post("/api/webhooks/stripe"))
                .andExpect(status().isNotFound());
    }

    @Test
    void permitsConfiguredCredentialedPreflight() throws Exception {
        mockMvc.perform(options("/test/mutate")
                        .header("Origin", "https://whole-haul.com")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "X-XSRF-TOKEN"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://whole-haul.com"))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
    }

    @Test
    void rejectsUnconfiguredCrossOriginPreflight() throws Exception {
        mockMvc.perform(options("/test/mutate")
                        .header("Origin", "https://evil.example")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden());
    }

    @RestController
    public static class TestController {
        @PostMapping("/test/mutate")
        String mutate() {
            return "ok";
        }

        @PostMapping("/api/webhooks/stripe")
        String webhook() {
            return "ok";
        }
    }
}
