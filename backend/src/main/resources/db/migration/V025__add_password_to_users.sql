-- Add password column to users table for local authentication
-- Nullable because OAuth2 users don't have passwords
ALTER TABLE users ADD COLUMN password_hash VARCHAR(255);
