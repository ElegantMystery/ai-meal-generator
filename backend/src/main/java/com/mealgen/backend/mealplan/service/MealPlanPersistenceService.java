package com.mealgen.backend.mealplan.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.model.MealPlan;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;

@Service
@RequiredArgsConstructor
public class MealPlanPersistenceService {

    private final MealPlanRepository mealPlanRepository;
    private final UserRepository userRepository;

    @Transactional
    public MealPlanResponse persistFromComplete(User user, JsonNode data) {
        String title = textOrDefault(data, "title", "AI Meal Plan");
        String startDateStr = textOrNull(data, "startDate");
        String endDateStr = textOrNull(data, "endDate");
        String planJson = textOrNull(data, "planJson");

        LocalDate startDate = (startDateStr == null || startDateStr.isBlank()) ? null : LocalDate.parse(startDateStr);
        LocalDate endDate = (endDateStr == null || endDateStr.isBlank()) ? null : LocalDate.parse(endDateStr);

        MealPlan saved = mealPlanRepository.save(MealPlan.builder()
                .user(user)
                .title(title)
                .startDate(startDate)
                .endDate(endDate)
                .planJson(planJson)
                .build());

        userRepository.incrementPlansGeneratedCount(user.getId());

        return MealPlanResponse.builder()
                .id(saved.getId())
                .title(saved.getTitle())
                .startDate(saved.getStartDate() == null ? null : saved.getStartDate().toString())
                .endDate(saved.getEndDate() == null ? null : saved.getEndDate().toString())
                .planJson(saved.getPlanJson())
                .createdAt(saved.getCreatedAt() == null ? null : saved.getCreatedAt().toString())
                .build();
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode n = node.get(field);
        return n == null || n.isNull() ? null : n.asText();
    }

    private static String textOrDefault(JsonNode node, String field, String def) {
        String v = textOrNull(node, field);
        return v == null ? def : v;
    }
}
