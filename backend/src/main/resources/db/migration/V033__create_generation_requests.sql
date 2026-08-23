CREATE TABLE generation_requests (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    quota_consumed BOOLEAN NOT NULL,
    quota_period_start DATE,
    failure_code VARCHAR(64),
    mealplan_id BIGINT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT fk_generation_requests_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_generation_requests_mealplan
        FOREIGN KEY (mealplan_id) REFERENCES mealplans(id) ON DELETE SET NULL,
    CONSTRAINT uq_generation_requests_user_key UNIQUE (user_id, idempotency_key),
    CONSTRAINT ck_generation_requests_status CHECK (
        status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED')
    ),
    CONSTRAINT ck_generation_requests_quota_period CHECK (
        (quota_consumed AND quota_period_start IS NOT NULL)
        OR (NOT quota_consumed AND quota_period_start IS NULL)
    ),
    CONSTRAINT ck_generation_requests_terminal_data CHECK (
        (status = 'SUCCEEDED' AND mealplan_id IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL)
        OR (status IN ('FAILED', 'ABANDONED') AND mealplan_id IS NULL AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
        OR (status IN ('PENDING', 'RUNNING') AND mealplan_id IS NULL AND completed_at IS NULL AND failure_code IS NULL)
    )
);

CREATE INDEX idx_generation_requests_user_created
    ON generation_requests(user_id, created_at DESC);

CREATE INDEX idx_generation_requests_cleanup
    ON generation_requests(status, updated_at);
