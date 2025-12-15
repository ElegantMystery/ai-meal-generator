-- Flyway migration: Create users table
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    provider VARCHAR(255),
    provider_id VARCHAR(255)
);

-- Create index on email for faster lookups (though unique constraint already creates an index)
-- Additional index on provider_id for OAuth lookups
CREATE INDEX idx_users_provider_id ON users(provider_id);