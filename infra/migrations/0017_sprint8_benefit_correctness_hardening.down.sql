BEGIN;

DROP INDEX benefit_jobs_lease_recovery_idx;
UPDATE benefit_jobs SET status='FAILED' WHERE status='DEAD_LETTER';
ALTER TABLE benefit_jobs
  DROP CONSTRAINT benefit_jobs_status_check,
  DROP COLUMN completed_at,
  DROP COLUMN last_error_message,
  DROP COLUMN last_error_code,
  DROP COLUMN max_attempts,
  ADD CONSTRAINT benefit_jobs_status_check CHECK(status IN('PENDING','PROCESSING','COMPLETED','FAILED'));

DROP FUNCTION sprint8_membership_metrics(uuid,uuid,timestamptz,integer);
ALTER TABLE customer_membership_assignments DROP COLUMN grace_until,DROP COLUMN assignment_source;

DROP TRIGGER benefit_refund_allocations_append_only ON benefit_refund_allocations;
DROP TRIGGER benefit_application_allocations_append_only ON benefit_application_allocations;
DROP TABLE benefit_refund_allocations,benefit_application_allocations;

DROP TABLE voucher_customer_usage;
ALTER TABLE voucher_redemption_entries ALTER COLUMN use_delta TYPE integer USING use_delta::integer;

DROP INDEX loyalty_reserved_lot_allocations_idx;
ALTER TABLE loyalty_redemption_lot_allocations DROP COLUMN released_at,DROP COLUMN consumed_at,DROP COLUMN status;
ALTER TABLE loyalty_point_lots
  DROP CONSTRAINT loyalty_point_lots_balance_check,
  DROP CONSTRAINT loyalty_point_lots_status_check,
  DROP COLUMN reserved_points,
  ADD CONSTRAINT loyalty_point_lots_status_check CHECK(status IN('AVAILABLE','EXHAUSTED','EXPIRED'));
ALTER TABLE loyalty_reservations
  DROP CONSTRAINT loyalty_reservation_point_contract_check,
  DROP COLUMN unused_points,DROP COLUMN accepted_points,DROP COLUMN requested_points;

DROP INDEX pos_order_one_active_package_per_line;
DROP INDEX pos_order_one_active_nonpackage_benefit_type;
ALTER TABLE pos_order_benefit_applications
  DROP CONSTRAINT benefit_application_package_line_check,
  DROP CONSTRAINT benefit_application_covered_line_fk,
  DROP COLUMN covered_order_line_id;
CREATE UNIQUE INDEX pos_order_one_active_benefit_type
  ON pos_order_benefit_applications(tenant_id,pos_order_id,benefit_type)
  WHERE status='RESERVED';

DELETE FROM schema_migrations WHERE version='0017_sprint8_benefit_correctness_hardening';
COMMIT;
