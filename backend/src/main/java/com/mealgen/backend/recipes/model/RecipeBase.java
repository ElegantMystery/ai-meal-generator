package com.mealgen.backend.recipes.model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "recipes_base")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RecipeBase {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Human-readable recipe name, e.g. "Costco Salmon Bowl"
     */
    @Column(nullable = false)
    private String name;

    /**
     * Short description or tags.
     */
    private String description;

    /**
     * High-level instructions (later you can move to structured steps).
     */
    @Column(columnDefinition = "text")
    private String instructions;

    /**
     * For Week 1, keep it as free-form text: e.g. "Rotisserie Chicken; Brown Rice; Frozen Broccoli"
     */
    @Column(columnDefinition = "text")
    private String ingredientsText;
}
