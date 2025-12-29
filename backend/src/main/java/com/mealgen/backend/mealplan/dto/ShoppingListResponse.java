package com.mealgen.backend.mealplan.dto;

import lombok.*;

import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShoppingListResponse {
    private Long mealplanId;
    private String store; // optional if you track it; else null
    private List<ShoppingListItemDto> items;
    private Double estimatedTotal;
    
    // Daily nutrition metrics (per day averages)
    private Double caloriesPerDay;
    private Double fatPerDay; // total fat in grams
    private Double proteinPerDay; // protein in grams
    private Double carbohydratesPerDay; // total carbohydrates in grams
    private Double sodiumPerDay; // sodium in mg
    private Double fiberPerDay; // dietary fiber in grams
    private Double sugarPerDay; // total sugars in grams
}
