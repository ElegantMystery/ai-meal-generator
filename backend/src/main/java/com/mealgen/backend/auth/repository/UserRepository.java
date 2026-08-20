package com.mealgen.backend.auth.repository;

import com.mealgen.backend.auth.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.time.LocalDate;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);
    Optional<User> findByProviderId(String providerId);
    Optional<User> findByStripeCustomerId(String stripeCustomerId);

    /**
     * Atomically starts a new UTC quota month or consumes one remaining slot in
     * the current month. The affected-row count is the reservation result.
     */
    @Modifying
    @Query(value = """
            UPDATE users
               SET plans_generated_count = CASE
                       WHEN quota_period_start = :periodStart
                           THEN plans_generated_count + 1
                       ELSE 1
                   END,
                   quota_period_start = :periodStart
             WHERE id = :userId
               AND (quota_period_start IS NULL
                    OR quota_period_start < :periodStart
                    OR plans_generated_count < :quotaLimit)
            """, nativeQuery = true)
    int reserveFreeGeneration(
            @Param("userId") Long userId,
            @Param("periodStart") LocalDate periodStart,
            @Param("quotaLimit") int quotaLimit
    );

    @Modifying
    @Query(value = """
            UPDATE users
               SET plans_generated_count = plans_generated_count - 1
             WHERE id = :userId
               AND quota_period_start = :periodStart
               AND plans_generated_count > 0
            """, nativeQuery = true)
    int releaseFreeGeneration(
            @Param("userId") Long userId,
            @Param("periodStart") LocalDate periodStart
    );
}
