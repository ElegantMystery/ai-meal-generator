-- Create embeddings tables for item_nutrition and item_ingredients
CREATE TABLE IF NOT EXISTS item_nutrition_embeddings (
  item_id BIGINT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  embedding vector NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS item_ingredients_embeddings (
  item_id BIGINT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  embedding vector NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_item_nutrition_embeddings_item_id ON item_nutrition_embeddings(item_id);
CREATE INDEX IF NOT EXISTS idx_item_ingredients_embeddings_item_id ON item_ingredients_embeddings(item_id);

-- Optional HNSW indexes for vector similarity search (uncomment if needed)
-- CREATE INDEX IF NOT EXISTS idx_item_nutrition_embeddings_hnsw ON item_nutrition_embeddings USING hnsw (embedding vector_cosine_ops);
-- CREATE INDEX IF NOT EXISTS idx_item_ingredients_embeddings_hnsw ON item_ingredients_embeddings USING hnsw (embedding vector_cosine_ops);

