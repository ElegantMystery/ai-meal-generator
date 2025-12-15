package com.mealgen.backend.mealplan.repository;

import com.mealgen.backend.mealplan.model.MealPlan;
import com.mealgen.backend.auth.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MealPlanRepository extends JpaRepository<MealPlan, Long> {
    List<MealPlan> findByUser(User user);
}
