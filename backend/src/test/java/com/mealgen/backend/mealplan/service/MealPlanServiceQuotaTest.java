package com.mealgen.backend.mealplan.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.ai.RagClient;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import com.mealgen.backend.preferences.repository.UserPreferencesRepository;
import com.mealgen.backend.subscription.exception.QuotaExceededException;
import com.mealgen.backend.subscription.service.QuotaReservation;
import com.mealgen.backend.subscription.service.SubscriptionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;

import java.time.LocalDate;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MealPlanServiceQuotaTest {

    @Mock UserRepository userRepository;
    @Mock UserPreferencesRepository preferencesRepository;
    @Mock MealPlanRepository mealPlanRepository;
    @Mock RagClient ragClient;
    @Mock SubscriptionService subscriptionService;
    @Mock MealPlanPersistenceService persistenceService;

    private MealPlanService service;
    private User user;
    private QuotaReservation reservation;

    @BeforeEach
    void setUp() {
        service = new MealPlanService(
                userRepository,
                preferencesRepository,
                mealPlanRepository,
                ragClient,
                subscriptionService,
                persistenceService
        );
        user = User.builder().id(1L).email("free@example.com").build();
        reservation = QuotaReservation.free(LocalDate.of(2026, 8, 1));
    }

    @Test
    void quotaRejection_happensBeforeCallingRag() {
        when(userRepository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        when(subscriptionService.reserveGeneration(user)).thenThrow(new QuotaExceededException());

        assertThatThrownBy(() -> service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7))
                .isInstanceOf(QuotaExceededException.class);

        verify(ragClient, never()).streamGenerate(any());
    }

    @Test
    void agentErrorEvent_releasesReservationAndTerminatesProtocol() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.just(
                event("error", "{\"code\":\"GENERATION_PROVIDER_UNAVAILABLE\","
                        + "\"message\":\"raw provider secret\",\"requestId\":\"wrong\"}"),
                event("complete", "{\"title\":\"must not persist\"}")
        ));

        List<ServerSentEvent<String>> events = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7).collectList().block();

        verify(subscriptionService).releaseGeneration(user.getId(), reservation);
        verify(persistenceService, never()).persistFromComplete(any(), any());
        JsonNode error = json(events.getFirst().data());
        assertThat(error.path("code").asText()).isEqualTo("GENERATION_PROVIDER_UNAVAILABLE");
        assertThat(error.path("message").asText())
                .isEqualTo("The meal planner is temporarily unavailable. Please try again.");
        assertThat(error.path("message").asText()).doesNotContain("secret");
        assertThat(error.path("requestId").asText()).isNotBlank().isNotEqualTo("wrong");
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
        verify(ragClient).streamGenerate(payload.capture());
        assertThat(payload.getValue().get("requestId"))
                .isEqualTo(error.path("requestId").asText());
    }

    @Test
    void transportError_releasesReservation() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.error(new RuntimeException("upstream")));

        List<ServerSentEvent<String>> events = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7).collectList().block();

        verify(subscriptionService).releaseGeneration(user.getId(), reservation);
        assertError(events, "GENERATION_INTERNAL_ERROR", "Meal plan generation failed. Please try again.");
    }

    @Test
    void providerHttpError_isSanitized() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.error(
                WebClientResponseException.create(
                        502, "provider body contains secret", null, new byte[0], StandardCharsets.UTF_8
                )
        ));

        List<ServerSentEvent<String>> events = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7).collectList().block();

        assertError(events, "GENERATION_PROVIDER_UNAVAILABLE",
                "The meal planner is temporarily unavailable. Please try again.");
    }

    @Test
    void timeout_isSanitized() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.error(new TimeoutException("secret timeout")));

        List<ServerSentEvent<String>> events = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7).collectList().block();

        assertError(events, "GENERATION_TIMEOUT", "Meal plan generation timed out. Please try again.");
    }

    @Test
    void databaseFailure_isSanitized() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.just(event(
                "complete",
                "{\"title\":\"Plan\",\"startDate\":\"2026-08-19\","
                        + "\"endDate\":\"2026-08-25\",\"planJson\":\"{}\"}"
        )));
        when(persistenceService.persistFromComplete(any(), any()))
                .thenThrow(new DataAccessResourceFailureException("database password leaked"));

        List<ServerSentEvent<String>> events = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7).collectList().block();

        assertError(events, "GENERATION_DATABASE_UNAVAILABLE",
                "Meal data is temporarily unavailable. Please try again.");
    }

    @Test
    void invalidCompletePayload_isSanitized() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.just(event("complete", "not-json-secret")));

        List<ServerSentEvent<String>> events = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7).collectList().block();

        assertError(events, "GENERATION_VALIDATION_FAILED",
                "The generated meal plan was invalid. Please try again.");
    }

    @Test
    void completeEvent_persistsWithoutReleasingReservation() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.just(event(
                "complete",
                "{\"title\":\"Plan\",\"startDate\":\"2026-08-19\","
                        + "\"endDate\":\"2026-08-25\",\"planJson\":\"{}\"}"
        )));
        when(persistenceService.persistFromComplete(any(), any())).thenReturn(
                MealPlanResponse.builder().id(10L).title("Plan").build()
        );

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7).collectList().block();

        verify(persistenceService).persistFromComplete(any(), any());
        verify(subscriptionService, never()).releaseGeneration(any(), any());
    }

    private void arrangeReservation() {
        when(userRepository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        when(subscriptionService.reserveGeneration(user)).thenReturn(reservation);
        when(preferencesRepository.findByUserId(user.getId())).thenReturn(Optional.empty());
    }

    private static ServerSentEvent<String> event(String name, String data) {
        return ServerSentEvent.<String>builder().event(name).data(data).build();
    }

    private static void assertError(
            List<ServerSentEvent<String>> events, String code, String message
    ) {
        assertThat(events).hasSize(1);
        JsonNode error = json(events.getFirst().data());
        assertThat(events.getFirst().event()).isEqualTo("error");
        assertThat(error.path("code").asText()).isEqualTo(code);
        assertThat(error.path("message").asText()).isEqualTo(message);
        assertThat(error.path("requestId").asText()).isNotBlank();
        assertThat(error.toString()).doesNotContain("secret", "password");
    }

    private static JsonNode json(String value) {
        try {
            return new ObjectMapper().readTree(value);
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }
}
