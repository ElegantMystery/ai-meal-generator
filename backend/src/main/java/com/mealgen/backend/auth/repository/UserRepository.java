package com.mealgen.backend.auth.repository;

import com.mealgen.backend.auth.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);
    Optional<User> findByProviderId(String providerId);
    Optional<User> findByStripeCustomerId(String stripeCustomerId);

    @Modifying
    @Query("UPDATE User u SET u.plansGeneratedCount = u.plansGeneratedCount + 1 WHERE u.id = :userId")
    void incrementPlansGeneratedCount(@Param("userId") Long userId);
}
