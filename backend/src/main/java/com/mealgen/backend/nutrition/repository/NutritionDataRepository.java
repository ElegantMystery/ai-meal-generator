package com.mealgen.backend.nutrition.repository;

import com.mealgen.backend.nutrition.model.NutritionData;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface NutritionDataRepository extends JpaRepository<NutritionData, Long> {
    Optional<NutritionData> findByItemId(Long itemId);
}
