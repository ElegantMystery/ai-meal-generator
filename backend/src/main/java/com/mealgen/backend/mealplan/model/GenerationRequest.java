package com.mealgen.backend.mealplan.model;

import com.mealgen.backend.auth.model.User;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "generation_requests", uniqueConstraints =
        @UniqueConstraint(name = "uq_generation_requests_user_key", columnNames = {"user_id", "idempotency_key"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class GenerationRequest {
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "idempotency_key", nullable = false, length = 255)
    private String idempotencyKey;

    @Column(name = "request_fingerprint", nullable = false, length = 64)
    private String requestFingerprint;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private GenerationRequestStatus status;

    @Column(name = "quota_consumed", nullable = false)
    private boolean quotaConsumed;

    @Column(name = "quota_period_start")
    private LocalDate quotaPeriodStart;

    @Column(name = "failure_code", length = 64)
    private String failureCode;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "mealplan_id")
    private MealPlan mealPlan;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;

    @PrePersist
    void onCreate() {
        OffsetDateTime now = OffsetDateTime.now();
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = OffsetDateTime.now();
    }
}
