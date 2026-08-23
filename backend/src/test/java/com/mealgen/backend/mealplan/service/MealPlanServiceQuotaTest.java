package com.mealgen.backend.mealplan.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.ai.RagClient;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.dto.GenerationRequestResponse;
import com.mealgen.backend.mealplan.model.GenerationRequest;
import com.mealgen.backend.mealplan.model.GenerationRequestStatus;
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
import java.util.UUID;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;

@ExtendWith(MockitoExtension.class)
class MealPlanServiceQuotaTest {

    @Mock UserRepository userRepository;
    @Mock UserPreferencesRepository preferencesRepository;
    @Mock MealPlanRepository mealPlanRepository;
    @Mock RagClient ragClient;
    @Mock MealPlanPersistenceService persistenceService;
    @Mock GenerationRequestService generationRequestService;
    @Mock SubscriptionService subscriptionService;

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
                persistenceService,
                generationRequestService,
                subscriptionService
        );
        user = User.builder().id(1L).email("free@example.com").build();
        reservation = QuotaReservation.free(LocalDate.of(2026, 8, 1));
    }

    @Test
    void quotaRejection_happensBeforeCallingRag() {
        when(userRepository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        arrangeClaim();
        when(generationRequestService.start(any(), eq(user))).thenThrow(new QuotaExceededException());

        assertThatThrownBy(() -> service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1"))
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
                user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        verify(generationRequestService).fail(
                any(), eq(user.getId()), eq(reservation),
                eq("GENERATION_UPSTREAM_ERROR"), eq("agent_error"));
        verify(persistenceService, never()).persistFromComplete(any(), any(), any());
        JsonNode error = errorData(events);
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
                user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        verify(generationRequestService).fail(
                any(), eq(user.getId()), eq(reservation),
                eq("GENERATION_INTERNAL_ERROR"), eq("transport_error"));
        assertError(events, "GENERATION_INTERNAL_ERROR", "Meal plan generation failed. Please try again.");
    }

    @Test
    void synchronousRagFailureIsCapturedAndSettlesRequest() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenThrow(new RuntimeException("connect failed"));

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        verify(generationRequestService).fail(
                any(), eq(user.getId()), eq(reservation),
                eq("GENERATION_INTERNAL_ERROR"), eq("transport_error"));
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
                user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        assertError(events, "GENERATION_PROVIDER_UNAVAILABLE",
                "The meal planner is temporarily unavailable. Please try again.");
    }

    @Test
    void timeout_isSanitized() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.error(new TimeoutException("secret timeout")));

        List<ServerSentEvent<String>> events = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

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
        when(persistenceService.persistFromComplete(any(), any(), any()))
                .thenThrow(new DataAccessResourceFailureException("database password leaked"));

        List<ServerSentEvent<String>> events = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        assertError(events, "GENERATION_DATABASE_UNAVAILABLE",
                "Meal data is temporarily unavailable. Please try again.");
    }

    @Test
    void invalidCompletePayload_isSanitized() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.just(event("complete", "not-json-secret")));

        List<ServerSentEvent<String>> events = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

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
        when(persistenceService.persistFromComplete(any(), any(), any())).thenReturn(
                MealPlanResponse.builder().id(10L).title("Plan").build()
        );

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        verify(persistenceService).persistFromComplete(any(), any(), any());
        verify(subscriptionService).completeGeneration(user.getId(), reservation);
        verify(generationRequestService, never()).fail(any(), any(), any(), any(), any());
    }

    @Test
    void duplicateRequestDoesNotReserveQuotaOrCallRagAgain() {
        when(userRepository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        GenerationRequest request = GenerationRequest.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-000000000002"))
                .user(user)
                .status(GenerationRequestStatus.RUNNING)
                .build();
        when(generationRequestService.claim(eq(user), eq("key-1"), any()))
                .thenReturn(new GenerationRequestClaim(request, false));
        when(generationRequestService.getOwned(user, request.getId())).thenReturn(
                GenerationRequestResponse.builder()
                        .id(request.getId())
                        .status(GenerationRequestStatus.RUNNING)
                        .build());

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        verify(generationRequestService, never()).start(any(), any());
        verify(ragClient, never()).streamGenerate(any());
    }

    @Test
    void idempotencyFingerprintExcludesPerAttemptCorrelationId() {
        when(userRepository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        when(preferencesRepository.findByUserId(user.getId())).thenReturn(Optional.empty());
        GenerationRequest first = duplicateRequest(UUID.randomUUID());
        GenerationRequest second = duplicateRequest(UUID.randomUUID());
        when(generationRequestService.claim(eq(user), eq("key-1"), any()))
                .thenReturn(new GenerationRequestClaim(first, false),
                        new GenerationRequestClaim(second, false));
        when(generationRequestService.getOwned(eq(user), any())).thenAnswer(invocation ->
                GenerationRequestResponse.builder()
                        .id(invocation.getArgument(1))
                        .status(GenerationRequestStatus.RUNNING)
                        .build());

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();
        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        ArgumentCaptor<String> fingerprints = ArgumentCaptor.forClass(String.class);
        verify(generationRequestService, times(2))
                .claim(eq(user), eq("key-1"), fingerprints.capture());
        assertThat(fingerprints.getAllValues()).hasSize(2).allMatch(
                fingerprints.getAllValues().getFirst()::equals);
    }

    @Test
    void duplicateCompleteEventPersistsExactlyOnce() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.just(
                event("complete", "{\"title\":\"Plan\",\"planJson\":\"{}\"}"),
                event("complete", "{\"title\":\"Duplicate\",\"planJson\":\"{}\"}")));
        when(persistenceService.persistFromComplete(any(), any(), any())).thenReturn(
                MealPlanResponse.builder().id(10L).title("Plan").build());

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        verify(persistenceService, times(1)).persistFromComplete(any(), any(), any());
    }

    @Test
    void browserCancellationRecordsFailureAndReleasesQuota() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.never());

        var subscription = service.streamGenerateAi(
                user.getEmail(), "TRADER_JOES", 7, "key-1").subscribe();
        subscription.dispose();

        verify(generationRequestService).fail(
                any(), eq(user.getId()), eq(reservation),
                eq("GENERATION_CANCELLED"), eq("client_cancelled"));
    }

    private void arrangeReservation() {
        when(userRepository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        when(generationRequestService.start(any(), eq(user))).thenReturn(reservation);
        when(preferencesRepository.findByUserId(user.getId())).thenReturn(Optional.empty());
        arrangeClaim();
    }

    private void arrangeClaim() {
        GenerationRequest request = GenerationRequest.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-000000000001"))
                .user(user)
                .idempotencyKey("key-1")
                .requestFingerprint("fingerprint")
                .status(GenerationRequestStatus.PENDING)
                .build();
        when(generationRequestService.claim(eq(user), eq("key-1"), any()))
                .thenReturn(new GenerationRequestClaim(request, true));
        lenient().when(generationRequestService.getOwned(user, request.getId())).thenReturn(
                GenerationRequestResponse.builder()
                        .id(request.getId())
                        .status(GenerationRequestStatus.RUNNING)
                        .build());
    }

    private GenerationRequest duplicateRequest(UUID id) {
        return GenerationRequest.builder()
                .id(id)
                .user(user)
                .idempotencyKey("key-1")
                .requestFingerprint("fingerprint")
                .status(GenerationRequestStatus.RUNNING)
                .build();
    }

    private static ServerSentEvent<String> event(String name, String data) {
        return ServerSentEvent.<String>builder().event(name).data(data).build();
    }

    private static void assertError(
            List<ServerSentEvent<String>> events, String code, String message
    ) {
        JsonNode error = errorData(events);
        assertThat(error.path("code").asText()).isEqualTo(code);
        assertThat(error.path("message").asText()).isEqualTo(message);
        assertThat(error.path("requestId").asText()).isNotBlank();
        assertThat(error.toString()).doesNotContain("secret", "password");
    }

    private static JsonNode errorData(List<ServerSentEvent<String>> events) {
        ServerSentEvent<String> error = events.stream()
                .filter(event -> "error".equals(event.event()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Missing SSE error event"));
        return json(error.data());
    }

    private static JsonNode json(String value) {
        try {
            return new ObjectMapper().readTree(value);
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }
}
