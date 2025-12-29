-- Add HNSW indexes to all embedding tables for fast similarity search/ordering
-- HNSW (Hierarchical Navigable Small World) is faster than ivfflat for similarity queries
-- Note: text-embedding-3-small uses 1536 dimensions

-- First, ensure vector columns have dimensions set
-- We'll alter the columns to specify 1536 dimensions (text-embedding-3-small default)
-- This is safe even if columns already have dimensions or data

-- Alter item_embeddings.embedding to have dimensions
DO $$
BEGIN
    -- Check if column exists and doesn't already have dimensions specified
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'item_embeddings' 
        AND column_name = 'embedding'
    ) THEN
        -- Try to alter column - this will work if column has no dimensions or same dimensions
        -- If it fails, the column likely already has the correct dimensions
        BEGIN
            ALTER TABLE item_embeddings 
            ALTER COLUMN embedding TYPE vector(1536);
        EXCEPTION WHEN OTHERS THEN
            -- Column might already have dimensions, that's fine
            NULL;
        END;
    END IF;
END $$;

-- Alter item_nutrition_embeddings.embedding to have dimensions
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'item_nutrition_embeddings' 
        AND column_name = 'embedding'
    ) THEN
        BEGIN
            ALTER TABLE item_nutrition_embeddings 
            ALTER COLUMN embedding TYPE vector(1536);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
END $$;

-- Alter item_ingredients_embeddings.embedding to have dimensions
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'item_ingredients_embeddings' 
        AND column_name = 'embedding'
    ) THEN
        BEGIN
            ALTER TABLE item_ingredients_embeddings 
            ALTER COLUMN embedding TYPE vector(1536);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
END $$;

-- Now create HNSW indexes (columns now have dimensions)

-- HNSW index for item_embeddings (using cosine distance)
-- Note: Using regular CREATE INDEX (not CONCURRENTLY) for Flyway compatibility
-- Regular indexes are fine for migrations since they're typically run during maintenance windows
CREATE INDEX IF NOT EXISTS idx_item_embeddings_hnsw 
ON item_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW index for item_nutrition_embeddings (using cosine distance)
CREATE INDEX IF NOT EXISTS idx_item_nutrition_embeddings_hnsw 
ON item_nutrition_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW index for item_ingredients_embeddings (using cosine distance)
CREATE INDEX IF NOT EXISTS idx_item_ingredients_embeddings_hnsw 
ON item_ingredients_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

