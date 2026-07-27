BEGIN;
DROP TRIGGER appointment_package_release ON appointments;
DROP FUNCTION sprint8_release_cancelled_appointment_packages();
DELETE FROM role_permissions WHERE permission_code IN (SELECT code FROM permissions WHERE code LIKE 'voucher.%' OR code LIKE 'loyalty.%' OR code LIKE 'membership.%' OR code LIKE 'package.%' OR code LIKE 'benefit.%');
DELETE FROM permissions WHERE code LIKE 'voucher.%' OR code LIKE 'loyalty.%' OR code LIKE 'membership.%' OR code LIKE 'package.%' OR code LIKE 'benefit.%';
DROP TABLE benefit_exports,benefit_jobs,benefit_liability_daily_snapshots,benefit_reversal_conflicts,pos_order_benefit_applications;
DROP TABLE package_ledger_entries,package_reservations,customer_package_entitlements,service_package_eligibility_items,service_package_products;
DROP TABLE customer_membership_metrics,customer_membership_assignments,membership_tiers;
DROP TABLE loyalty_adjustment_requests,loyalty_redemption_lot_allocations,loyalty_point_lots,loyalty_ledger_entries,loyalty_reservations,loyalty_accounts;
ALTER TABLE loyalty_programs
  DROP CONSTRAINT loyalty_programs_supersedes_fk,
  DROP CONSTRAINT loyalty_programs_creator_fk,
  DROP CONSTRAINT loyalty_programs_effective_check,
  DROP CONSTRAINT loyalty_programs_ratio_check,
  DROP CONSTRAINT loyalty_programs_earn_basis_check,
  DROP CONSTRAINT loyalty_programs_status_check,
  DROP CONSTRAINT loyalty_programs_tenant_id_id_key,
  DROP COLUMN earn_basis,DROP COLUMN spend_minor_per_point,DROP COLUMN redemption_points,DROP COLUMN redemption_minor,
  DROP COLUMN settlement_delay_hours,DROP COLUMN points_valid_days,DROP COLUMN negative_balance_policy,DROP COLUMN effective_from,
  DROP COLUMN effective_to,DROP COLUMN version,DROP COLUMN policy_json,DROP COLUMN created_by_user_id,DROP COLUMN supersedes_program_id,
  DROP COLUMN created_at,DROP COLUMN updated_at;
DROP TABLE voucher_redemption_entries,voucher_reservations,voucher_codes,voucher_campaign_customers,voucher_campaign_services,voucher_campaign_branches,voucher_campaigns;
DROP FUNCTION sprint8_append_only_guard();
DELETE FROM schema_migrations WHERE version='0016_voucher_loyalty_membership_package';
COMMIT;
