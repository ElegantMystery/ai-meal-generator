package com.mealgen.backend.mealplan.repository;

import com.mealgen.backend.mealplan.model.MealPlan;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface MealPlanRepository extends JpaRepository<MealPlan, Long> {
    List<MealPlan> findByUserIdOrderByCreatedAtDesc(Long userId);

    Optional<MealPlan> findByIdAndUserId(Long id, Long userId);

    long deleteByIdAndUserId(Long id, Long userId);
}
