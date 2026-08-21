package com.mealgen.backend.auth.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    private String name;

    // e.g. "google"
    private String provider;

    // e.g. Google "sub" id
    private String providerId;

    // Tracks whether user has completed or skipped the onboarding flow
    @Builder.Default
    @Column(name = "onboarding_completed", nullable = false)
    private boolean onboardingCompleted = false;

    @Column(name = "stripe_customer_id")
    private String stripeCustomerId;

    @Builder.Default
    @Column(name = "plans_generated_count", nullable = false)
    private int plansGeneratedCount = 0;

    /** UTC calendar month to which plansGeneratedCount belongs. */
    @Column(name = "quota_period_start")
    private LocalDate quotaPeriodStart;
}
