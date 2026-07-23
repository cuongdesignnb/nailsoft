BEGIN;

CREATE TABLE booking_otp_delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  challenge_id uuid NOT NULL REFERENCES booking_access_challenges(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('BOOKING_ACCESS','BOOKING_CONFIRMATION','BOOKING_RESCHEDULE','BOOKING_CANCEL')),
  channel text NOT NULL CHECK (channel IN ('SMS','EMAIL')),
  destination text NOT NULL,
  code_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','DELIVERED','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by varchar(160),
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(challenge_id)
);
CREATE INDEX booking_otp_delivery_jobs_pending_idx
  ON booking_otp_delivery_jobs(status,available_at,created_at)
  WHERE status IN ('PENDING','FAILED');

INSERT INTO schema_migrations(version)
VALUES ('0010_public_booking_security_hardening');

COMMIT;
