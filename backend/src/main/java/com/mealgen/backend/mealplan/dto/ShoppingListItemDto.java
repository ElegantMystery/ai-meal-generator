package com.mealgen.backend.mealplan.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShoppingListItemDto {
    private Long id;
    private String name;
    private Integer qty;
    private Double price;
    private String unitSize;
    private String imageUrl;
    private Double lineTotal; // price * qty (nullable if price null)
}
