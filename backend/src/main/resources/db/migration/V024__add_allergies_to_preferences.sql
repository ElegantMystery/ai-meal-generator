-- Add allergies column and remove disliked_ingredients column
-- Replacing disliked_ingredients with allergies for better clarity

-- Add allergies column
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS allergies TEXT;

-- Migrate existing data from disliked_ingredients to allergies (if any exists)
UPDATE user_preferences
SET allergies = disliked_ingredients
WHERE disliked_ingredients IS NOT NULL AND allergies IS NULL;

-- Remove the old disliked_ingredients column
ALTER TABLE user_preferences
  DROP COLUMN IF EXISTS disliked_ingredients;

