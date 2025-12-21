-- Vxxx__item_embeddings.sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS item_embeddings (
  item_id BIGINT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  embedding vector NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Optional index
-- CREATE INDEX IF NOT EXISTS idx_item_embeddings_hnsw ON item_embeddings USING hnsw (embedding vector_cosine_ops);
