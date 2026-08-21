-- FREE-tier usage is measured in UTC calendar months. Existing lifetime usage is
-- assigned to the migration month so deployment never grants surprise extra use.
ALTER TABLE users
    ADD COLUMN quota_period_start DATE;

UPDATE users
   SET quota_period_start = date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
 WHERE plans_generated_count > 0;

ALTER TABLE users
    ADD CONSTRAINT chk_users_plans_generated_count_nonnegative
    CHECK (plans_generated_count >= 0),
    ADD CONSTRAINT chk_users_quota_period_starts_month
    CHECK (quota_period_start IS NULL OR EXTRACT(DAY FROM quota_period_start) = 1);
