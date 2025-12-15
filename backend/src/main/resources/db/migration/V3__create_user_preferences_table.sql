-- Flyway migration: Create user_preferences table
CREATE TABLE user_preferences (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    dietary_restrictions TEXT,
    disliked_ingredients TEXT,
    target_calories_per_day INTEGER,
    CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create index on user_id for faster lookups (though unique constraint already creates an index)
-- Additional index on target_calories_per_day for potential filtering queries
CREATE INDEX idx_user_preferences_target_calories ON user_preferences(target_calories_per_day);

