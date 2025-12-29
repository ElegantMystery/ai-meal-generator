-- Create table for storing raw nutrition facts text for items
CREATE TABLE IF NOT EXISTS item_nutrition (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL,
    nutrition TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_item_nutrition_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT uq_item_nutrition_item UNIQUE (item_id)
);

-- Create table for storing ingredients text for items
CREATE TABLE IF NOT EXISTS item_ingredients (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL,
    ingredients TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_item_ingredients_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT uq_item_ingredients_item UNIQUE (item_id)
);

-- Create indexes on item_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_item_nutrition_item_id ON item_nutrition(item_id);
CREATE INDEX IF NOT EXISTS idx_item_ingredients_item_id ON item_ingredients(item_id);

-- Create index for full-text search on ingredients (useful for filtering)
CREATE INDEX IF NOT EXISTS idx_item_ingredients_fts ON item_ingredients USING gin(to_tsvector('english', COALESCE(ingredients, '')));

