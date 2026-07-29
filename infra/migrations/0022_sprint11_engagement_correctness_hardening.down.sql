BEGIN;
DELETE FROM schema_migrations WHERE version='0022_sprint11_engagement_correctness_hardening';

INSERT INTO role_permissions(role,permission_code) VALUES
('BRANCH_MANAGER','communication.template.manage'),('BRANCH_MANAGER','communication.rule.manage') ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS loyalty_adjustment_recovery_sync ON loyalty_adjustment_requests;
DROP TRIGGER IF EXISTS stored_value_adjustment_recovery_sync ON stored_value_adjustment_requests;
DROP FUNCTION IF EXISTS sprint11_sync_recovery_compensation();
ALTER TABLE service_recovery_compensation_requests DROP COLUMN IF EXISTS posted_at,DROP COLUMN IF EXISTS sync_error_code,DROP COLUMN IF EXISTS sync_status;
DROP INDEX IF EXISTS review_requests_due_idx;
ALTER TABLE review_requests DROP COLUMN IF EXISTS policy_version,DROP COLUMN IF EXISTS due_at;
ALTER TABLE marketing_campaigns DROP COLUMN IF EXISTS cancelled_total,DROP COLUMN IF EXISTS failed_total,DROP COLUMN IF EXISTS suppressed_total,DROP COLUMN IF EXISTS sent_total,DROP COLUMN IF EXISTS final_generation;
ALTER TABLE marketing_campaign_audience DROP CONSTRAINT marketing_campaign_audience_status_check;
ALTER TABLE marketing_campaign_audience ADD CONSTRAINT marketing_campaign_audience_status_check CHECK(status IN('ELIGIBLE','SENT','SKIPPED','SUPPRESSED'));
ALTER TABLE communication_messages DROP CONSTRAINT IF EXISTS communication_messages_frequency_reservation_fk;
DROP TABLE IF EXISTS marketing_frequency_reservations;
DROP TRIGGER IF EXISTS communication_suppressions_generation ON communication_suppressions;
DROP FUNCTION IF EXISTS sprint11_bump_suppression_generation();
DROP TABLE IF EXISTS communication_suppression_generations;
ALTER TABLE communication_messages DROP COLUMN IF EXISTS frequency_reservation_id,DROP COLUMN IF EXISTS suppression_generation,DROP COLUMN IF EXISTS preference_version,DROP COLUMN IF EXISTS consent_state_version,DROP COLUMN IF EXISTS claim_expires_at,DROP COLUMN IF EXISTS claim_token;
ALTER TABLE communication_settings DROP COLUMN IF EXISTS campaign_audience_limit,DROP COLUMN IF EXISTS review_requests_enabled_from,DROP COLUMN IF EXISTS review_request_policy_version,DROP COLUMN IF EXISTS review_request_delay_hours;
COMMIT;
