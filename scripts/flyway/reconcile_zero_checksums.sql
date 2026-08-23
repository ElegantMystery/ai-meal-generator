\set ON_ERROR_STOP on

BEGIN;

DO $audit$
DECLARE
    matching_rows integer;
    unexpected_rows integer;
BEGIN
    SELECT count(*) INTO matching_rows
      FROM flyway_schema_history h
      JOIN (VALUES
          (1, 'V1__create_items_table.sql'), (2, 'V2__create_users_table.sql'),
          (3, 'V3__create_user_preferences_table.sql'), (4, 'V4__create_mealplans_table.sql'),
          (5, 'V5__create_item_embedding.sql'), (20, 'V020__enable_pgvector.sql'),
          (21, 'V021__create_item_nutrition_and_ingredients_tables.sql'),
          (22, 'V022__create_nutrition_ingredients_embeddings.sql'),
          (23, 'V023__add_hnsw_indexes_to_embeddings.sql'),
          (24, 'V024__add_allergies_to_preferences.sql'),
          (25, 'V025__add_password_to_users.sql'), (26, 'V026__add_onboarding_completed.sql'),
          (27, 'V027__create_recipes_table.sql'), (28, 'V028__create_subscriptions_table.sql')
      ) expected(version, script)
        ON h.version::integer = expected.version AND h.script = expected.script
     WHERE h.success AND h.checksum = 0;

    SELECT count(*) INTO unexpected_rows
      FROM flyway_schema_history h
     WHERE h.checksum = 0
       AND NOT EXISTS (
           SELECT 1 FROM (VALUES
              (1, 'V1__create_items_table.sql'), (2, 'V2__create_users_table.sql'),
              (3, 'V3__create_user_preferences_table.sql'), (4, 'V4__create_mealplans_table.sql'),
              (5, 'V5__create_item_embedding.sql'), (20, 'V020__enable_pgvector.sql'),
              (21, 'V021__create_item_nutrition_and_ingredients_tables.sql'),
              (22, 'V022__create_nutrition_ingredients_embeddings.sql'),
              (23, 'V023__add_hnsw_indexes_to_embeddings.sql'),
              (24, 'V024__add_allergies_to_preferences.sql'),
              (25, 'V025__add_password_to_users.sql'), (26, 'V026__add_onboarding_completed.sql'),
              (27, 'V027__create_recipes_table.sql'), (28, 'V028__create_subscriptions_table.sql')
           ) expected(version, script)
          WHERE h.version::integer = expected.version AND h.script = expected.script
       );

    IF matching_rows <> 14 OR unexpected_rows <> 0 THEN
        RAISE EXCEPTION 'Refusing reconciliation: expected 14 known zero-checksum rows, found % known and % unexpected',
            matching_rows, unexpected_rows;
    END IF;
    IF to_regclass('public.flyway_schema_history_backup_aud007_20260821') IS NOT NULL THEN
        RAISE EXCEPTION 'Backup table flyway_schema_history_backup_aud007_20260821 already exists';
    END IF;
END
$audit$;

CREATE TABLE flyway_schema_history_backup_aud007_20260821
    (LIKE flyway_schema_history INCLUDING ALL);
INSERT INTO flyway_schema_history_backup_aud007_20260821
SELECT * FROM flyway_schema_history;

UPDATE flyway_schema_history h
   SET checksum = expected.checksum
  FROM (VALUES
      (1, 'V1__create_items_table.sql', -1788137011),
      (2, 'V2__create_users_table.sql', -1322484112),
      (3, 'V3__create_user_preferences_table.sql', 1001337106),
      (4, 'V4__create_mealplans_table.sql', -1653307618),
      (5, 'V5__create_item_embedding.sql', -212642348),
      (20, 'V020__enable_pgvector.sql', -929483003),
      (21, 'V021__create_item_nutrition_and_ingredients_tables.sql', -184707631),
      (22, 'V022__create_nutrition_ingredients_embeddings.sql', 761179448),
      (23, 'V023__add_hnsw_indexes_to_embeddings.sql', 1946210910),
      (24, 'V024__add_allergies_to_preferences.sql', -1166691541),
      (25, 'V025__add_password_to_users.sql', -662653085),
      (26, 'V026__add_onboarding_completed.sql', -514781544),
      (27, 'V027__create_recipes_table.sql', 2089800453),
      (28, 'V028__create_subscriptions_table.sql', 708635770)
  ) expected(version, script, checksum)
 WHERE h.version::integer = expected.version
   AND h.script = expected.script
   AND h.success
   AND h.checksum = 0;

DO $audit$
BEGIN
    IF (SELECT count(*) FROM flyway_schema_history_backup_aud007_20260821) <> 14 THEN
        RAISE EXCEPTION 'Backup row count is not 14';
    END IF;
    IF EXISTS (SELECT 1 FROM flyway_schema_history WHERE checksum = 0) THEN
        RAISE EXCEPTION 'Zero checksums remain after reconciliation';
    END IF;
END
$audit$;

COMMIT;
