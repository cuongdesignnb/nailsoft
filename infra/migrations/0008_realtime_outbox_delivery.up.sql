BEGIN;

ALTER TABLE outbox_events
  ADD COLUMN delivery_status text,
  ADD COLUMN attempt_count integer,
  ADD COLUMN available_at timestamptz,
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN locked_by varchar(160),
  ADD COLUMN processed_at timestamptz,
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN last_error text;

UPDATE outbox_events
SET delivery_status = CASE
      WHEN published_at IS NOT NULL OR status = 'PUBLISHED' THEN 'PROCESSED'
      WHEN status = 'FAILED' THEN 'FAILED'
      ELSE 'PENDING'
    END,
    attempt_count = attempts,
    available_at = created_at,
    processed_at = published_at,
    failed_at = CASE WHEN status = 'FAILED' THEN COALESCE(published_at, created_at) END;

ALTER TABLE outbox_events
  ALTER COLUMN delivery_status SET DEFAULT 'PENDING',
  ALTER COLUMN delivery_status SET NOT NULL,
  ALTER COLUMN attempt_count SET DEFAULT 0,
  ALTER COLUMN attempt_count SET NOT NULL,
  ALTER COLUMN available_at SET DEFAULT now(),
  ALTER COLUMN available_at SET NOT NULL,
  ADD CONSTRAINT outbox_delivery_status_check
    CHECK (delivery_status IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
  ADD CONSTRAINT outbox_attempt_count_check CHECK (attempt_count >= 0);

DROP INDEX IF EXISTS outbox_pending_idx;
CREATE INDEX outbox_pending_idx
  ON outbox_events(delivery_status, available_at, created_at)
  WHERE delivery_status = 'PENDING';
CREATE INDEX outbox_stale_lock_idx
  ON outbox_events(delivery_status, locked_at)
  WHERE delivery_status = 'PROCESSING';

INSERT INTO schema_migrations(version)
VALUES ('0008_realtime_outbox_delivery');

COMMIT;
