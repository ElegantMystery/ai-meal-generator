package com.mealgen.backend.preferences.model;

import com.mealgen.backend.auth.model.User;
import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "user_preferences")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserPreferences {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    /**
     * e.g. "vegetarian;no_pork;no_shellfish"
     */
    @Column(name = "dietary_restrictions", columnDefinition = "text")
    private String dietaryRestrictions;

    /**
     * e.g. "cilantro;blue_cheese"
     */
    @Column(name = "disliked_ingredients", columnDefinition = "text")
    private String dislikedIngredients;

    /**
     * Target calories per day for planning.
     */
    @Column(name = "target_calories_per_day")
    private Integer targetCaloriesPerDay;
}
