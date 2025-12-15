-- Flyway migration: Create items table
CREATE TABLE items (
    id BIGSERIAL PRIMARY KEY,
    store VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    external_id VARCHAR(255) NOT NULL,
    price DOUBLE PRECISION,
    unit_size VARCHAR(255),
    category_path VARCHAR(255),
    image_url VARCHAR(255),
    tags_json JSONB,
    raw_json JSONB,
    CONSTRAINT uq_items_store_external UNIQUE (store, external_id)
);

-- Create indexes if they don't exist
CREATE INDEX idx_items_store ON items(store);
CREATE INDEX idx_items_external_id ON items(external_id);