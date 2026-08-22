package com.mealgen.backend.mealplan.repository;

import com.mealgen.backend.mealplan.model.GenerationRequest;
import com.mealgen.backend.mealplan.model.GenerationRequestStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.domain.Pageable;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;

import java.time.OffsetDateTime;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import java.util.List;

public interface GenerationRequestRepository extends JpaRepository<GenerationRequest, UUID> {
    @Modifying
    @Query(value = """
            insert into generation_requests
                (id, user_id, idempotency_key, request_fingerprint, status,
                 quota_consumed, created_at, updated_at)
            values (:id, :userId, :idempotencyKey, :fingerprint, 'PENDING', false, :now, :now)
            on conflict (user_id, idempotency_key) do nothing
            """, nativeQuery = true)
    int insertPending(UUID id, Long userId, String idempotencyKey, String fingerprint, OffsetDateTime now);

    Optional<GenerationRequest> findByUserIdAndIdempotencyKey(Long userId, String idempotencyKey);

    Optional<GenerationRequest> findByIdAndUserId(UUID id, Long userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select request from GenerationRequest request
             where request.status in (:statuses)
               and request.updatedAt < :staleBefore
             order by request.updatedAt
            """)
    List<GenerationRequest> lockStale(
            List<GenerationRequestStatus> statuses,
            OffsetDateTime staleBefore,
            Pageable pageable
    );

    @Modifying
    @Query("""
            delete from GenerationRequest request
             where request.status in (:statuses)
               and request.completedAt < :completedBefore
            """)
    int deleteCompletedBefore(
            List<GenerationRequestStatus> statuses,
            OffsetDateTime completedBefore
    );

    @Modifying
    @Query("""
            update GenerationRequest request
               set request.status = com.mealgen.backend.mealplan.model.GenerationRequestStatus.RUNNING,
                   request.quotaConsumed = :quotaConsumed,
                   request.quotaPeriodStart = :quotaPeriodStart,
                   request.updatedAt = :now
             where request.id = :id
               and request.status = com.mealgen.backend.mealplan.model.GenerationRequestStatus.PENDING
            """)
    int markRunning(UUID id, boolean quotaConsumed, LocalDate quotaPeriodStart, OffsetDateTime now);

    @Modifying
    @Query("""
            update GenerationRequest request
               set request.status = com.mealgen.backend.mealplan.model.GenerationRequestStatus.FAILED,
                   request.failureCode = :failureCode,
                   request.completedAt = :now,
                   request.updatedAt = :now
             where request.id = :id
               and request.status in (
                   com.mealgen.backend.mealplan.model.GenerationRequestStatus.PENDING,
                   com.mealgen.backend.mealplan.model.GenerationRequestStatus.RUNNING)
            """)
    int markFailed(UUID id, String failureCode, OffsetDateTime now);

    @Modifying
    @Query("""
            update GenerationRequest request
               set request.status = com.mealgen.backend.mealplan.model.GenerationRequestStatus.SUCCEEDED,
                   request.mealPlan = :mealPlan,
                   request.completedAt = :now,
                   request.updatedAt = :now
             where request.id = :id
               and request.status = com.mealgen.backend.mealplan.model.GenerationRequestStatus.RUNNING
            """)
    int markSucceeded(
            UUID id,
            com.mealgen.backend.mealplan.model.MealPlan mealPlan,
            OffsetDateTime now
    );

}
