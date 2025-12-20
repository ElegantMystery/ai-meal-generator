package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.dto.MealPlanCreateRequest;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.model.MealPlan;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;

@Service
@RequiredArgsConstructor
public class MealPlanService {

    private final UserRepository userRepository;
    private final MealPlanRepository mealPlanRepository;

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
}
