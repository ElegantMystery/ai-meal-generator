package com.mealgen.backend.mealplan.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MealPlanResponse {
    private Long id;
    private String title;
    private String startDate;  // "YYYY-MM-DD"
    private String endDate;    // "YYYY-MM-DD"
    private String planJson;
    private String createdAt;  // ISO string
}
