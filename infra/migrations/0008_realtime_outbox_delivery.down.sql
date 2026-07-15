BEGIN;

DROP INDEX IF EXISTS outbox_stale_lock_idx;
DROP INDEX IF EXISTS outbox_pending_idx;
CREATE INDEX outbox_pending_idx ON outbox_events(status,created_at) WHERE status='PENDING';

ALTER TABLE outbox_events
  DROP CONSTRAINT IF EXISTS outbox_attempt_count_check,
  DROP CONSTRAINT IF EXISTS outbox_delivery_status_check,
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS failed_at,
  DROP COLUMN IF EXISTS processed_at,
  DROP COLUMN IF EXISTS locked_by,
  DROP COLUMN IF EXISTS locked_at,
  DROP COLUMN IF EXISTS available_at,
  DROP COLUMN IF EXISTS attempt_count,
  DROP COLUMN IF EXISTS delivery_status;

DELETE FROM schema_migrations
WHERE version = '0008_realtime_outbox_delivery';

COMMIT;
