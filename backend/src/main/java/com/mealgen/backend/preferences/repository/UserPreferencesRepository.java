package com.mealgen.backend.preferences.repository;

import com.mealgen.backend.preferences.model.UserPreferences;
import com.mealgen.backend.auth.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserPreferencesRepository extends JpaRepository<UserPreferences, Long> {
    Optional<UserPreferences> findByUserId(Long userId);
}
