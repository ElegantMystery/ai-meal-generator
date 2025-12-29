-- Script to verify HNSW indexes are created and working
-- Run this in your PostgreSQL database

-- 1. Check if all three HNSW indexes exist
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE indexname LIKE '%_hnsw'
ORDER BY tablename, indexname;

-- 2. Verify the index type is HNSW
SELECT 
    i.relname AS index_name,
    t.relname AS table_name,
    am.amname AS index_type,
    pg_size_pretty(pg_relation_size(i.oid)) AS index_size
FROM pg_class i
JOIN pg_am am ON i.relam = am.oid
JOIN pg_index idx ON i.oid = idx.indexrelid
JOIN pg_class t ON idx.indrelid = t.oid
WHERE i.relname LIKE '%_hnsw'
ORDER BY t.relname, i.relname;

-- 3. Check index parameters (HNSW-specific)
SELECT 
    c.relname AS index_name,
    t.relname AS table_name,
    pg_indexes_size(c.oid) AS index_size_bytes,
    pg_size_pretty(pg_indexes_size(c.oid)) AS index_size
FROM pg_class c
JOIN pg_index i ON c.oid = i.indexrelid
JOIN pg_class t ON i.indrelid = t.oid
WHERE c.relname LIKE '%_hnsw'
ORDER BY t.relname, c.relname;

-- 4. Test a similarity query to verify index usage
-- This will show if the index is being used (check the execution plan)
-- Note: Using a sample embedding from the table to test (1536 dimensions)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT 
    i.id,
    i.name,
    1 - (ie.embedding <=> (SELECT embedding FROM item_embeddings LIMIT 1)) AS similarity
FROM items i
JOIN item_embeddings ie ON i.id = ie.item_id
WHERE i.store = 'TRADER_JOES'
ORDER BY ie.embedding <=> (SELECT embedding FROM item_embeddings LIMIT 1)
LIMIT 10;

-- 5. Check if indexes are being used (look for "Index Scan" or "Index Only Scan" in the plan)
-- The query above should show the HNSW index being used

-- 6. Count rows in each embedding table
SELECT 
    'item_embeddings' AS table_name,
    COUNT(*) AS row_count
FROM item_embeddings
UNION ALL
SELECT 
    'item_nutrition_embeddings' AS table_name,
    COUNT(*) AS row_count
FROM item_nutrition_embeddings
UNION ALL
SELECT 
    'item_ingredients_embeddings' AS table_name,
    COUNT(*) AS row_count
FROM item_ingredients_embeddings;

