package com.mealgen.backend.mealplan.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.dto.MealPlanCreateRequest;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.model.MealPlan;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import com.mealgen.backend.mealplan.ai.RagClient;
import com.mealgen.backend.preferences.model.UserPreferences;
import com.mealgen.backend.preferences.repository.UserPreferencesRepository;
import com.mealgen.backend.subscription.service.QuotaReservation;
import com.mealgen.backend.subscription.service.SubscriptionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
@Slf4j
@RequiredArgsConstructor
public class MealPlanService {

    private static final String CONFIGURATION_ERROR = "GENERATION_CONFIGURATION_ERROR";
    private static final String PROVIDER_ERROR = "GENERATION_PROVIDER_UNAVAILABLE";
    private static final String DATABASE_ERROR = "GENERATION_DATABASE_UNAVAILABLE";
    private static final String VALIDATION_ERROR = "GENERATION_VALIDATION_FAILED";
    private static final String TIMEOUT_ERROR = "GENERATION_TIMEOUT";
    private static final String INTERNAL_ERROR = "GENERATION_INTERNAL_ERROR";
    private static final Set<String> PUBLIC_ERROR_CODES = Set.of(
            CONFIGURATION_ERROR, PROVIDER_ERROR, DATABASE_ERROR,
            VALIDATION_ERROR, TIMEOUT_ERROR, INTERNAL_ERROR
    );

    private final UserRepository userRepository;
    private final UserPreferencesRepository preferencesRepository;
    private final MealPlanRepository mealPlanRepository;
    private final RagClient ragClient;
    private final SubscriptionService subscriptionService;
    private final MealPlanPersistenceService mealPlanPersistenceService;
    // ObjectMapper is not exposed as a bean in this Spring Boot 4 setup — instantiate directly.
    private final ObjectMapper objectMapper = new ObjectMapper();

    public List<MealPlanResponse> listMine(String email) {
        User user = getUserByEmail(email);
        return mealPlanRepository.findByUserIdOrderByCreatedAtDesc(user.getId())
                .stream()
                .map(this::toResponse)
                .toList();
    }

    public MealPlanResponse getMineById(String email, Long id) {
        User user = getUserByEmail(email);
        MealPlan plan = mealPlanRepository.findByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("Meal plan not found"));
        return toResponse(plan);
    }

    @Transactional
    public MealPlanResponse createMine(String email, MealPlanCreateRequest req) {
        User user = getUserByEmail(email);

        String title = (req.getTitle() == null || req.getTitle().trim().isEmpty())
                ? "My Meal Plan"
                : req.getTitle().trim();

        LocalDate start = parseDate(req.getStartDate());
        LocalDate end = parseDate(req.getEndDate());

        MealPlan plan = MealPlan.builder()
                .user(user)
                .title(title)
                .startDate(start)
                .endDate(end)
                .planJson(req.getPlanJson())
                .build();

        MealPlan saved = mealPlanRepository.save(plan);
        return toResponse(saved);
    }

    @Transactional
    public void deleteMine(String email, Long id) {
        User user = getUserByEmail(email);
        long deleted = mealPlanRepository.deleteByIdAndUserId(id, user.getId());
        if (deleted == 0) {
            throw new IllegalArgumentException("Meal plan not found");
        }
    }

    private User getUserByEmail(String email) {
        return userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found for email: " + email));
    }

    private LocalDate parseDate(String s) {
        if (s == null || s.trim().isEmpty()) return null;
        return LocalDate.parse(s.trim());
    }

    private MealPlanResponse toResponse(MealPlan p) {
        return MealPlanResponse.builder()
                .id(p.getId())
                .title(p.getTitle())
                .startDate(p.getStartDate() == null ? null : p.getStartDate().toString())
                .endDate(p.getEndDate() == null ? null : p.getEndDate().toString())
                .planJson(p.getPlanJson())
                .createdAt(p.getCreatedAt() == null ? null : p.getCreatedAt().toString())
                .build();
    }

    /**
     * Streaming agentic generation. Forwards SSE events from the RAG service;
     * on the terminal 'complete' event, persists the meal plan and increments
     * the user's quota counter, then emits a synthesised 'mealplan_saved' event
     * carrying the saved entity.
     *
     * Quota check runs eagerly before the stream is subscribed -- a FREE-tier
     * user at limit gets QuotaExceededException synchronously from the
     * controller, not buried in a stream error.
     */
    public Flux<ServerSentEvent<String>> streamGenerateAi(String email, String store, int days) {
        if (days < 1 || days > 14) {
            throw new IllegalArgumentException("days must be between 1 and 14");
        }

        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found for email: " + email));

        // This commits before the asynchronous stream starts, preventing parallel
        // FREE requests from all passing the same read/check race.
        QuotaReservation reservation = subscriptionService.reserveGeneration(user);

        UserPreferences prefs = preferencesRepository.findByUserId(user.getId()).orElse(null);

        Map<String, Object> preferences = new LinkedHashMap<>();
        preferences.put("dietaryRestrictions", prefs == null ? null : prefs.getDietaryRestrictions());
        preferences.put("allergies", prefs == null ? null : prefs.getAllergies());
        preferences.put("targetCaloriesPerDay", prefs == null ? null : prefs.getTargetCaloriesPerDay());

        Map<String, Object> payload = new LinkedHashMap<>();
        String requestId = UUID.randomUUID().toString();
        payload.put("userId", user.getId());
        payload.put("requestId", requestId);
        payload.put("store", store);
        payload.put("days", days);
        payload.put("preferences", preferences);

        AtomicReference<ServerSentEvent<String>> savedEvent = new AtomicReference<>();
        AtomicBoolean quotaSettled = new AtomicBoolean(false);

        return ragClient.streamGenerate(payload)
                .map(sse -> {
                    String eventName = sse.event();
                    String rawData = sse.data();
                    if ("complete".equals(eventName) && rawData != null) {
                        try {
                            JsonNode data = objectMapper.readTree(rawData);
                            MealPlanResponse response = mealPlanPersistenceService.persistFromComplete(user, data);
                            savedEvent.set(buildSavedEvent(response));
                            quotaSettled.set(true);
                        } catch (Exception e) {
                            throw new IllegalStateException("Failed to parse complete event data", e);
                        }
                    } else if ("error".equals(eventName)) {
                        releaseReservation(user.getId(), reservation, quotaSettled);
                        return sanitizeUpstreamError(rawData, requestId);
                    }
                    return forwardSse(sse);
                })
                // complete/error are terminal protocol events. Do not accept a
                // contradictory later event that could desynchronise quota state.
                .takeUntil(sse -> "complete".equals(sse.event()) || "error".equals(sse.event()))
                .concatWith(Flux.defer(() -> {
                    ServerSentEvent<String> saved = savedEvent.get();
                    return saved == null ? Flux.empty() : Flux.just(saved);
                }))
                .onErrorResume(err -> {
                    releaseReservation(user.getId(), reservation, quotaSettled);
                    String code = errorCode(err);
                    log.error("generation_failed code={} requestId={}", code, requestId, err);
                    return Flux.just(errorEvent(code, requestId));
                })
                .doOnCancel(() -> releaseReservation(user.getId(), reservation, quotaSettled))
                .doOnComplete(() -> releaseReservation(user.getId(), reservation, quotaSettled));
    }

    private void releaseReservation(
            Long userId,
            QuotaReservation reservation,
            AtomicBoolean quotaSettled
    ) {
        if (quotaSettled.compareAndSet(false, true)) {
            subscriptionService.releaseGeneration(userId, reservation);
        }
    }

    private ServerSentEvent<String> forwardSse(ServerSentEvent<String> sse) {
        return ServerSentEvent.<String>builder()
                .event(sse.event())
                .data(sse.data() == null ? "{}" : sse.data())
                .build();
    }

    private ServerSentEvent<String> buildSavedEvent(MealPlanResponse response) {
        try {
            return ServerSentEvent.<String>builder()
                    .event("mealplan_saved")
                    .data(objectMapper.writeValueAsString(response))
                    .build();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialise mealplan_saved event", e);
        }
    }

    private ServerSentEvent<String> sanitizeUpstreamError(String rawData, String requestId) {
        String code = INTERNAL_ERROR;
        if (rawData != null) {
            try {
                String candidate = objectMapper.readTree(rawData).path("code").asText();
                if (PUBLIC_ERROR_CODES.contains(candidate)) {
                    code = candidate;
                }
            } catch (Exception e) {
                log.warn("invalid_generation_error requestId={}", requestId, e);
            }
        }
        return errorEvent(code, requestId);
    }

    private ServerSentEvent<String> errorEvent(String code, String requestId) {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("code", code);
        node.put("message", safeErrorMessage(code));
        node.put("requestId", requestId);
        return ServerSentEvent.<String>builder()
                .event("error")
                .data(node.toString())
                .build();
    }

    private static String errorCode(Throwable err) {
        if (hasCause(err, TimeoutException.class)) {
            return TIMEOUT_ERROR;
        }
        if (hasCause(err, WebClientRequestException.class)
                || hasCause(err, WebClientResponseException.class)) {
            return PROVIDER_ERROR;
        }
        if (hasCause(err, DataAccessException.class)) {
            return DATABASE_ERROR;
        }
        if (hasCause(err, com.fasterxml.jackson.core.JsonProcessingException.class)
                || hasCause(err, IllegalArgumentException.class)) {
            return VALIDATION_ERROR;
        }
        return INTERNAL_ERROR;
    }

    private static boolean hasCause(Throwable err, Class<? extends Throwable> type) {
        Throwable current = err;
        while (current != null) {
            if (type.isInstance(current)) return true;
            current = current.getCause();
        }
        return false;
    }

    private static String safeErrorMessage(String code) {
        return switch (code) {
            case CONFIGURATION_ERROR -> "Meal plan generation is temporarily unavailable.";
            case PROVIDER_ERROR -> "The meal planner is temporarily unavailable. Please try again.";
            case DATABASE_ERROR -> "Meal data is temporarily unavailable. Please try again.";
            case VALIDATION_ERROR -> "The generated meal plan was invalid. Please try again.";
            case TIMEOUT_ERROR -> "Meal plan generation timed out. Please try again.";
            default -> "Meal plan generation failed. Please try again.";
        };
    }
}
