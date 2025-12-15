package com.mealgen.backend.recipes.repository;

import com.mealgen.backend.recipes.model.RecipeBase;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RecipeBaseRepository extends JpaRepository<RecipeBase, Long> {
}
