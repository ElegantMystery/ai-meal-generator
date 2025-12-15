package com.mealgen.backend.mealplan.model;

import com.mealgen.backend.auth.model.User;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;

@Entity
@Table(name = "mealplans")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MealPlan {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Owner of this meal plan.
     */
    @ManyToOne
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    private String title;          // e.g. "Week 1 – High Protein"

    private LocalDate startDate;
    private LocalDate endDate;

    /**
     * For Week 1: free-form JSON/text (you can refine later).
     * e.g. { "monday": ["Recipe 1", "Recipe 2"], "tuesday": [...] }
     */
    @Column(columnDefinition = "text")
    private String planJson;
}
