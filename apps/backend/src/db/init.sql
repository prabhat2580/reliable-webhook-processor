-- Create enum for event status
DO $$ BEGIN
    CREATE TYPE event_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. Webhook events table (The queue & source of truth)
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status event_status NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by VARCHAR(100),
    locked_until TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for worker polling with SKIP LOCKED
CREATE INDEX IF NOT EXISTS idx_events_polling ON events (status, next_run_at, locked_until);

-- 2. Business action table: exactly one row per processed order
CREATE TABLE IF NOT EXISTS processed_orders (
    order_id VARCHAR(255) PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL UNIQUE REFERENCES events(event_id),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Attempt history table (stretch requirement)
CREATE TABLE IF NOT EXISTS event_attempts (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    attempt_number INT NOT NULL,
    worker_identifier VARCHAR(100) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    finish_time TIMESTAMPTZ,
    result VARCHAR(50) NOT NULL, -- 'SUCCESS', 'TEMPORARY_FAILURE', 'PERMANENT_FAILURE'
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_attempts_event_id ON event_attempts (event_id);
