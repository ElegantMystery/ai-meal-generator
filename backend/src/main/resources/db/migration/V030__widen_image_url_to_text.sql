-- Whole Foods image URLs can exceed 255 characters; widen to TEXT
ALTER TABLE items ALTER COLUMN image_url TYPE TEXT;
