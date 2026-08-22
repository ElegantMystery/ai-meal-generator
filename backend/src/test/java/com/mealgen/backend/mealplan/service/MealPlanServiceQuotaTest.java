package com.mealgen.backend.mealplan.service;

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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.codec.ServerSentEvent;
import reactor.core.publisher.Flux;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

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
                generationRequestService
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
                event("error", "{\"code\":\"failed\"}"),
                event("complete", "{\"title\":\"must not persist\"}")
        ));

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        verify(generationRequestService).fail(any(), eq(user.getId()), eq(reservation), any());
        verify(persistenceService, never()).persistFromComplete(any(), any(), any());
    }

    @Test
    void transportError_releasesReservation() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.error(new RuntimeException("upstream")));

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        verify(generationRequestService).fail(any(), eq(user.getId()), eq(reservation), any());
    }

    @Test
    void synchronousRagFailureIsCapturedAndSettlesRequest() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenThrow(new RuntimeException("connect failed"));

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7, "key-1").collectList().block();

        verify(generationRequestService).fail(
                any(), eq(user.getId()), eq(reservation), eq("GENERATION_FAILED"));
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
        verify(generationRequestService, never()).fail(any(), any(), any(), any());
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
                any(), eq(user.getId()), eq(reservation), eq("GENERATION_CANCELLED"));
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

    private static ServerSentEvent<String> event(String name, String data) {
        return ServerSentEvent.<String>builder().event(name).data(data).build();
    }
}
