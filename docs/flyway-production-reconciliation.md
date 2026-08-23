# Flyway production reconciliation (AUD-007)

## Why production checksums were zero

Production was manually bootstrapped through V028. During that bootstrap, all
successful rows in `flyway_schema_history` had their checksums set to `0`, and
commit `6596675` disabled `validate-on-migrate` to allow the application to
start. The repository contains no evidence that Flyway generated those zero
values. A read-only audit on 2026-08-21 confirmed exactly 14 successful V1–V28
rows with zero checksums; V29 and later migrations were not yet recorded.

Canonical checksums were derived by applying the repository's immutable SQL
files to a fresh `pgvector/pgvector:pg18` database with Flyway 11.14.1. The
fresh database migrated successfully from V1 through V032.

The production reconciliation was completed on 2026-08-21. The retained backup
contains all 14 original rows, active history contains no zero checksums, and
the reconciled values match the canonical V1–V28 checksums.

## Reconciliation procedure

1. Stop if production history differs from the audited shape.
2. Run `scripts/flyway/reconcile_zero_checksums.sql` against production with
   `psql`. It validates the exact row set and creates
   `flyway_schema_history_backup_aud007_20260821` before updating checksums in
   the same transaction. It deliberately does not invoke broad `flyway repair`.
3. Confirm the backup contains 14 rows and no active history checksum is zero.
4. Run `flyway migrate`, which validates the reconciled applied migrations
   before applying V29–V32, and then run `flyway validate` on the complete
   history. Only after both succeed, deploy the backend with
   `validate-on-migrate: true`.

Rollback before deployment, if needed:

```sql
BEGIN;
DELETE FROM flyway_schema_history;
INSERT INTO flyway_schema_history
SELECT * FROM flyway_schema_history_backup_aud007_20260821;
COMMIT;
```

Retain the backup until at least one successful validated production deployment
and an independent database backup have completed.
