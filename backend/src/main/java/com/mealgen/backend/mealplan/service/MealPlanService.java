package com.mealgen.backend.mealplan.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.dto.MealPlanCreateRequest;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.dto.GenerationRequestResponse;
import com.mealgen.backend.mealplan.model.GenerationRequest;
import com.mealgen.backend.mealplan.model.MealPlan;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import com.mealgen.backend.mealplan.ai.RagClient;
import com.mealgen.backend.preferences.model.UserPreferences;
import com.mealgen.backend.preferences.repository.UserPreferencesRepository;
import com.mealgen.backend.subscription.service.QuotaReservation;
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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.UUID;
import java.security.MessageDigest;
import java.util.HexFormat;

@Service
@Slf4j
@RequiredArgsConstructor
public class MealPlanService {

    private final UserRepository userRepository;
    private final UserPreferencesRepository preferencesRepository;
    private final MealPlanRepository mealPlanRepository;
    private final RagClient ragClient;
    private final MealPlanPersistenceService mealPlanPersistenceService;
    private final GenerationRequestService generationRequestService;
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
    public Flux<ServerSentEvent<String>> streamGenerateAi(
            String email, String store, int days, String idempotencyKey) {
        if (days < 1 || days > 14) {
            throw new IllegalArgumentException("days must be between 1 and 14");
        }

        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found for email: " + email));

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

        GenerationRequestClaim claim = generationRequestService.claim(
                user, idempotencyKey, fingerprint(payload));
        GenerationRequest generationRequest = claim.request();
        if (!claim.owner()) {
            return Flux.just(generationStatusEvent(
                    generationRequestService.getOwned(user, generationRequest.getId())));
        }

        // Only the owner of the durable request reserves quota. Concurrent retries
        // with the same key observe the existing request and never call RAG.
        QuotaReservation reservation;
        try {
            reservation = generationRequestService.start(generationRequest.getId(), user);
        } catch (RuntimeException error) {
            generationRequestService.markFailed(generationRequest.getId(), failureCode(error));
            throw error;
        }
        payload.put("generationRequestId", generationRequest.getId().toString());

        AtomicReference<ServerSentEvent<String>> savedEvent = new AtomicReference<>();
        AtomicBoolean quotaSettled = new AtomicBoolean(false);

        return Flux.concat(
                Flux.defer(() -> Flux.just(generationStatusEvent(
                        generationRequestService.getOwned(user, generationRequest.getId())))),
                Flux.defer(() -> ragClient.streamGenerate(payload))
                        .map(sse -> {
                            String eventName = sse.event();
                            String rawData = sse.data();
                            if ("complete".equals(eventName) && rawData != null) {
                                try {
                                    JsonNode data = objectMapper.readTree(rawData);
                                    MealPlanResponse response = mealPlanPersistenceService.persistFromComplete(
                                            generationRequest.getId(), user, data);
                                    savedEvent.set(buildSavedEvent(response));
                                    quotaSettled.set(true);
                                } catch (Exception e) {
                                    throw new IllegalStateException("Failed to parse complete event data", e);
                                }
                            } else if ("error".equals(eventName)) {
                                failGeneration(user.getId(), generationRequest.getId(), reservation,
                                        quotaSettled, "GENERATION_UPSTREAM_ERROR");
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
        )
                .onErrorResume(err -> {
                    failGeneration(user.getId(), generationRequest.getId(), reservation,
                            quotaSettled, failureCode(err));
                    log.error("Streaming generate-ai failed", err);
                    return Flux.just(errorEvent(err));
                })
                .doOnCancel(() -> failGeneration(user.getId(), generationRequest.getId(), reservation,
                        quotaSettled, "GENERATION_CANCELLED"))
                .doOnComplete(() -> {
                    if (!quotaSettled.get()) {
                        failGeneration(user.getId(), generationRequest.getId(), reservation,
                                quotaSettled, "GENERATION_INCOMPLETE");
                    }
                });
    }

    public GenerationRequestResponse getGenerationRequest(String email, UUID id) {
        return generationRequestService.getOwned(getUserByEmail(email), id);
    }

    public GenerationRequestResponse getGenerationRequest(String email, String idempotencyKey) {
        return generationRequestService.getOwnedByKey(getUserByEmail(email), idempotencyKey);
    }

    private void failGeneration(
            Long userId,
            UUID generationRequestId,
            QuotaReservation reservation,
            AtomicBoolean quotaSettled,
        String failureCode
    ) {
        if (quotaSettled.compareAndSet(false, true)) {
            generationRequestService.fail(
                    generationRequestId, userId, reservation, failureCode);
        }
    }

    private ServerSentEvent<String> generationStatusEvent(GenerationRequestResponse response) {
        try {
            return ServerSentEvent.<String>builder()
                    .event("generation_status")
                    .data(objectMapper.writeValueAsString(response))
                    .build();
        } catch (Exception error) {
            throw new IllegalStateException("Failed to serialise generation status", error);
        }
    }

    private String fingerprint(Map<String, Object> payload) {
        try {
            byte[] canonicalPayload = objectMapper.writeValueAsBytes(payload);
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(canonicalPayload));
        } catch (Exception error) {
            throw new IllegalStateException("Failed to fingerprint generation request", error);
        }
    }

    private static String failureCode(Throwable error) {
        if (error instanceof com.mealgen.backend.subscription.exception.QuotaExceededException) {
            return "GENERATION_QUOTA_EXCEEDED";
        }
        return "GENERATION_FAILED";
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
