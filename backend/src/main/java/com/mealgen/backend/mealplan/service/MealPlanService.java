package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.dto.MealPlanCreateRequest;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.model.MealPlan;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import com.mealgen.backend.mealplan.ai.RagClient;
import com.mealgen.backend.preferences.model.UserPreferences;
import com.mealgen.backend.preferences.repository.UserPreferencesRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class MealPlanService {

    private final UserRepository userRepository;
    private final UserPreferencesRepository preferencesRepository;
    private final MealPlanRepository mealPlanRepository;
    private final RagClient ragClient;

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

    @Transactional
    public MealPlanResponse generateAi(String email, String store, int days) {
        if (days < 1 || days > 14) {
            throw new IllegalArgumentException("days must be between 1 and 14");
        }

        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found for email: " + email));

        UserPreferences prefs = preferencesRepository.findByUserId(user.getId()).orElse(null);

        // Build payload for python-rag
        Map<String, Object> preferences = new LinkedHashMap<>();
        preferences.put("dietaryRestrictions", prefs == null ? null : prefs.getDietaryRestrictions());
        preferences.put("dislikedIngredients", prefs == null ? null : prefs.getDislikedIngredients());
        preferences.put("targetCaloriesPerDay", prefs == null ? null : prefs.getTargetCaloriesPerDay());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("userId", user.getId());
        payload.put("store", store);
        payload.put("days", days);
        payload.put("preferences", preferences);

        // Call python-rag /generate
        Map result = ragClient.callGenerate(payload);
        if (result == null) {
            throw new IllegalStateException("RAG service returned null");
        }

        String title = (String) result.getOrDefault("title", "AI Meal Plan");
        String startDateStr = (String) result.get("startDate");
        String endDateStr = (String) result.get("endDate");
        String planJson = (String) result.get("planJson");

        LocalDate startDate = (startDateStr == null || startDateStr.isBlank()) ? null : LocalDate.parse(startDateStr);
        LocalDate endDate = (endDateStr == null || endDateStr.isBlank()) ? null : LocalDate.parse(endDateStr);

        MealPlan saved = mealPlanRepository.save(MealPlan.builder()
                .user(user)
                .title(title)
                .startDate(startDate)
                .endDate(endDate)
                .planJson(planJson)
                .build());

        return MealPlanResponse.builder()
                .id(saved.getId())
                .title(saved.getTitle())
                .startDate(saved.getStartDate() == null ? null : saved.getStartDate().toString())
                .endDate(saved.getEndDate() == null ? null : saved.getEndDate().toString())
                .planJson(saved.getPlanJson())
                .createdAt(saved.getCreatedAt() == null ? null : saved.getCreatedAt().toString())
                .build();
    }
}
