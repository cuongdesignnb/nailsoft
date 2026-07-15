BEGIN;

DELETE FROM role_permissions WHERE permission_code IN (
  'appointment.read','appointment.read_branch','appointment.read_own','appointment.create','appointment.confirm',
  'appointment.reschedule','appointment.cancel','appointment.assign_staff','appointment.override_policy','appointment.waive_deposit',
  'slot_hold.read','slot_hold.create','slot_hold.release','customer.booking_lookup','customer.booking_create'
);
DELETE FROM permissions WHERE code IN (
  'appointment.read','appointment.read_branch','appointment.read_own','appointment.create','appointment.confirm',
  'appointment.reschedule','appointment.cancel','appointment.assign_staff','appointment.override_policy','appointment.waive_deposit',
  'slot_hold.read','slot_hold.create','slot_hold.release','customer.booking_lookup','customer.booking_create'
);

DROP TRIGGER booking_availability_slot_holds ON slot_holds;
DROP TRIGGER booking_availability_resource_reservations ON resource_schedule_reservations;
DROP TRIGGER booking_availability_staff_reservations ON staff_schedule_reservations;
DROP FUNCTION bump_booking_availability_version();

ALTER TABLE idempotency_keys
  DROP COLUMN created_at,
  DROP COLUMN idempotency_key_hash,
  DROP COLUMN command_type,
  DROP COLUMN actor_scope;

DROP TABLE booking_notification_jobs;
DROP TABLE booking_access_challenges;
DROP TRIGGER appointment_schedule_revisions_append_only ON appointment_schedule_revisions;
DROP TRIGGER appointment_status_history_append_only ON appointment_status_history;
DROP FUNCTION booking_append_only_guard();
DROP TABLE appointment_schedule_revisions;
DROP TABLE appointment_status_history;
DROP TABLE resource_schedule_reservations;
DROP TABLE staff_schedule_reservations;
DROP TABLE slot_hold_items;
DROP TABLE slot_holds;
DROP TABLE appointment_item_resource_allocations;
DROP TABLE appointment_item_staff_assignments;
DROP TABLE appointment_items;
DROP TABLE appointment_participants;

DROP INDEX appointments_customer_history_idx;
DROP INDEX appointments_tenant_reference_unique;
ALTER TABLE appointments
  DROP CONSTRAINT appointments_updated_by_fkey,
  DROP CONSTRAINT appointments_created_by_fkey,
  DROP CONSTRAINT appointments_cancelled_by_fkey,
  DROP CONSTRAINT appointments_confirmed_by_fkey,
  DROP CONSTRAINT appointments_deposit_waived_by_fkey,
  DROP CONSTRAINT appointments_contact_verification_version_check,
  DROP CONSTRAINT appointments_confirmed_metadata_check,
  DROP CONSTRAINT appointments_cancelled_metadata_check,
  DROP CONSTRAINT appointments_deposit_waiver_check,
  DROP CONSTRAINT appointments_deposit_status_check,
  DROP CONSTRAINT appointments_deposit_required_check,
  DROP CONSTRAINT appointments_version_check,
  DROP CONSTRAINT appointments_schedule_version_check,
  DROP CONSTRAINT appointments_locale_check,
  DROP CONSTRAINT appointments_status_check,
  DROP CONSTRAINT appointments_source_check,
  DROP COLUMN updated_at,
  DROP COLUMN created_at,
  DROP COLUMN contact_verification_version,
  DROP COLUMN updated_by_user_id,
  DROP COLUMN created_by_user_id,
  DROP COLUMN cancellation_outcome,
  DROP COLUMN cancellation_note,
  DROP COLUMN cancellation_reason_code,
  DROP COLUMN cancelled_by_user_id,
  DROP COLUMN cancelled_at,
  DROP COLUMN confirmed_by_user_id,
  DROP COLUMN confirmed_at,
  DROP COLUMN expires_at,
  DROP COLUMN internal_note,
  DROP COLUMN customer_note,
  DROP COLUMN deposit_waiver_reason,
  DROP COLUMN deposit_waived_by_user_id,
  DROP COLUMN deposit_status,
  DROP COLUMN deposit_required_minor,
  DROP COLUMN pricing_summary_json,
  DROP COLUMN policy_snapshot_json,
  DROP COLUMN contact_snapshot_json,
  DROP COLUMN schedule_version,
  DROP COLUMN timezone,
  DROP COLUMN locale,
  DROP COLUMN source,
  DROP COLUMN booking_reference;

DROP INDEX customers_tenant_email_unique;
ALTER TABLE customers
  DROP CONSTRAINT customers_contact_verification_version_check,
  DROP CONSTRAINT customers_status_check,
  DROP CONSTRAINT customers_locale_check,
  DROP COLUMN updated_at,
  DROP COLUMN created_at,
  DROP COLUMN contact_verification_version,
  DROP COLUMN status,
  DROP COLUMN is_guest,
  DROP COLUMN preferred_locale,
  DROP COLUMN email_normalized;

DELETE FROM schema_migrations WHERE version='0009_booking_appointment_lifecycle';
COMMIT;
