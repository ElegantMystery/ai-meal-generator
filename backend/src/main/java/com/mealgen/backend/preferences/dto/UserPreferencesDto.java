package com.mealgen.backend.preferences.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserPreferencesDto {
    private String dietaryRestrictions;
    private String dislikedIngredients;
    private Integer targetCaloriesPerDay;
}
