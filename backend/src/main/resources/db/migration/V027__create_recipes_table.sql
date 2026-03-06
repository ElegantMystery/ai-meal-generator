-- Recipes imported from Spoonacular (or other sources).
-- Used to guide dish-centric meal plan generation.

CREATE TABLE IF NOT EXISTS recipes (
    id              BIGSERIAL PRIMARY KEY,
    source_id       VARCHAR(64)  NOT NULL,          -- e.g. spoonacular recipe ID
    source          VARCHAR(32)  NOT NULL DEFAULT 'spoonacular',
    title           VARCHAR(255) NOT NULL,
    image_url       VARCHAR(512),
    ready_minutes   INT,
    servings        INT,
    dish_types      TEXT[],                          -- breakfast, lunch, dinner, etc.
    diets           TEXT[],                          -- vegetarian, vegan, gluten-free, etc.
    cuisines        TEXT[],
    ingredients_json TEXT,                           -- JSON: [{name, amount, unit, aisle}]
    instructions    TEXT,                            -- plain text summary of steps
    raw_json        JSONB,                           -- full Spoonacular response
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recipes_source UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_recipes_dish_types ON recipes USING gin(dish_types);
CREATE INDEX IF NOT EXISTS idx_recipes_diets      ON recipes USING gin(diets);
CREATE INDEX IF NOT EXISTS idx_recipes_source     ON recipes(source);

-- Vector embeddings for recipe title + ingredients (for future semantic retrieval)
CREATE TABLE IF NOT EXISTS recipe_embeddings (
    id          BIGSERIAL PRIMARY KEY,
    recipe_id   BIGINT NOT NULL,
    embedding   vector(1536),
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_recipe_embeddings_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    CONSTRAINT uq_recipe_embeddings_recipe UNIQUE (recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_embeddings_hnsw
    ON recipe_embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
