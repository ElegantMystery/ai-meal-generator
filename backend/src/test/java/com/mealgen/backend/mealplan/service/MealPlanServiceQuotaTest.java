package com.mealgen.backend.mealplan.service;

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
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.codec.ServerSentEvent;
import reactor.core.publisher.Flux;

import java.time.LocalDate;
import java.util.Optional;

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
                event("error", "{\"code\":\"failed\"}"),
                event("complete", "{\"title\":\"must not persist\"}")
        ));

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7).collectList().block();

        verify(subscriptionService).releaseGeneration(user.getId(), reservation);
        verify(persistenceService, never()).persistFromComplete(any(), any());
    }

    @Test
    void transportError_releasesReservation() {
        arrangeReservation();
        when(ragClient.streamGenerate(any())).thenReturn(Flux.error(new RuntimeException("upstream")));

        service.streamGenerateAi(user.getEmail(), "TRADER_JOES", 7).collectList().block();

        verify(subscriptionService).releaseGeneration(user.getId(), reservation);
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
}
