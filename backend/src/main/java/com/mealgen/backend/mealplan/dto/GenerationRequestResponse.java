package com.mealgen.backend.mealplan.dto;

import com.mealgen.backend.mealplan.model.GenerationRequest;
import com.mealgen.backend.mealplan.model.GenerationRequestStatus;
import lombok.Builder;

import java.time.OffsetDateTime;
import java.util.UUID;

@Builder
public record GenerationRequestResponse(
        UUID id,
        GenerationRequestStatus status,
        String failureCode,
        Long mealPlanId,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        OffsetDateTime completedAt
) {
    public static GenerationRequestResponse from(GenerationRequest request) {
        return GenerationRequestResponse.builder()
                .id(request.getId())
                .status(request.getStatus())
                .failureCode(request.getFailureCode())
                .mealPlanId(request.getMealPlan() == null ? null : request.getMealPlan().getId())
                .createdAt(request.getCreatedAt())
                .updatedAt(request.getUpdatedAt())
                .completedAt(request.getCompletedAt())
                .build();
    }
}
