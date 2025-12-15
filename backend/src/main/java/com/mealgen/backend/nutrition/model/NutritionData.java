package com.mealgen.backend.nutrition.model;

import com.mealgen.backend.items.model.Item;
import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "nutrition_data")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class NutritionData {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Link to an item (Costco / Trader Joe's)
     */
    @OneToOne
    @JoinColumn(name = "item_id", nullable = false)
    private Item item;

    private Integer calories;    // per serving
    private Double protein;      // g
    private Double carbs;        // g
    private Double fat;          // g

    private String servingSize;  // e.g. "1 cup (140g)"
}
