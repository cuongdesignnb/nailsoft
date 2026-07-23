BEGIN;

DROP TABLE booking_otp_delivery_jobs;
DELETE FROM schema_migrations WHERE version='0010_public_booking_security_hardening';

COMMIT;
