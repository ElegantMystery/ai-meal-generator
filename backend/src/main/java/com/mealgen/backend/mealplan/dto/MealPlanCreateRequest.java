package com.mealgen.backend.mealplan.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MealPlanCreateRequest {
    private String title;
    private String startDate; // "YYYY-MM-DD"
    private String endDate;   // "YYYY-MM-DD"
    private String planJson;  // JSON string (MVP)
}
