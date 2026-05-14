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
import com.mealgen.backend.subscription.exception.QuotaExceededException;
import com.mealgen.backend.subscription.service.SubscriptionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import reactor.core.publisher.Flux;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

@Service
@Slf4j
@RequiredArgsConstructor
public class MealPlanService {

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

        if (!subscriptionService.canGenerate(user)) {
            throw new QuotaExceededException();
        }

        UserPreferences prefs = preferencesRepository.findByUserId(user.getId()).orElse(null);

        Map<String, Object> preferences = new LinkedHashMap<>();
        preferences.put("dietaryRestrictions", prefs == null ? null : prefs.getDietaryRestrictions());
        preferences.put("allergies", prefs == null ? null : prefs.getAllergies());
        preferences.put("targetCaloriesPerDay", prefs == null ? null : prefs.getTargetCaloriesPerDay());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("userId", user.getId());
        payload.put("store", store);
        payload.put("days", days);
        payload.put("preferences", preferences);

        AtomicReference<ServerSentEvent<String>> savedEvent = new AtomicReference<>();

        return ragClient.streamGenerate(payload)
                .map(sse -> {
                    String eventName = sse.event();
                    String rawData = sse.data();
                    if ("complete".equals(eventName) && rawData != null) {
                        try {
                            JsonNode data = objectMapper.readTree(rawData);
                            MealPlanResponse response = mealPlanPersistenceService.persistFromComplete(user, data);
                            savedEvent.set(buildSavedEvent(response));
                        } catch (Exception e) {
                            throw new IllegalStateException("Failed to parse complete event data", e);
                        }
                    }
                    return forwardSse(sse);
                })
                .concatWith(Flux.defer(() -> {
                    ServerSentEvent<String> saved = savedEvent.get();
                    return saved == null ? Flux.empty() : Flux.just(saved);
                }))
                .onErrorResume(err -> {
                    log.error("Streaming generate-ai failed", err);
                    return Flux.just(errorEvent(err));
                });
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

    private ServerSentEvent<String> errorEvent(Throwable err) {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("code", "stream_error");
        node.put("message", safeErrorMessage(err));
        return ServerSentEvent.<String>builder()
                .event("error")
                .data(node.toString())
                .build();
    }

    private static String safeErrorMessage(Throwable err) {
        if (err instanceof org.springframework.web.reactive.function.client.WebClientResponseException wce) {
            return "Upstream service error (" + wce.getStatusCode().value() + ")";
        }
        if (err instanceof IllegalArgumentException) {
            return err.getMessage();
        }
        return "An unexpected error occurred. Please try again.";
    }
}
