BEGIN;

-- Deterministic, non-PII Sprint 8 fixtures. Voucher plaintext is never stored.
INSERT INTO voucher_campaigns(
  id,tenant_id,name,description,status,discount_type,discount_value,currency,
  minimum_spend_minor,maximum_discount_minor,total_use_limit,per_customer_use_limit,
  code_use_limit,refund_policy,valid_from,valid_until,created_by_user_id
) VALUES (
  'c8000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'Seed Welcome 10%','Deterministic Sprint 8 voucher fixture','ACTIVE','PERCENT',1000,NULL,
  50000,50000,100,1,1,'RESTORE_USE',now()-interval '1 day',now()+interval '90 days',
  '30000000-0000-4000-8000-000000000002'
) ON CONFLICT DO NOTHING;

INSERT INTO voucher_campaign_branches(tenant_id,campaign_id,branch_id) VALUES (
  '10000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001'
) ON CONFLICT DO NOTHING;
INSERT INTO voucher_campaign_services(tenant_id,campaign_id,service_id) VALUES (
  '10000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001'
) ON CONFLICT DO NOTHING;
INSERT INTO voucher_codes(
  id,tenant_id,campaign_id,customer_id,code_hash,code_last4,status,use_limit,generation_key,
  expires_at,issued_by_user_id
) VALUES (
  'c8000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
  encode(hmac('10000000-0000-4000-8000-000000000001:WELCOME10','development-only-voucher-hmac-secret','sha256'),'hex'),
  'ME10','AVAILABLE',1,'seed:sprint8:voucher:welcome10',now()+interval '30 days',
  '30000000-0000-4000-8000-000000000002'
) ON CONFLICT DO NOTHING;

UPDATE loyalty_programs SET
  name='Seed Rewards',status='ACTIVE',earn_basis='NET_ORDER_AFTER_DISCOUNT_BEFORE_TIP',
  spend_minor_per_point=10000,redemption_points=100,redemption_minor=10000,
  settlement_delay_hours=24,points_valid_days=365,effective_from=now()-interval '1 day',
  policy_json='{"fixture":true}'::jsonb,created_by_user_id='30000000-0000-4000-8000-000000000002'
WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND name IN('Rewards','Seed Rewards');

INSERT INTO loyalty_accounts(
  id,tenant_id,customer_id,pending_points,available_points,reserved_points,lifetime_earned_points
) VALUES (
  'c8000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',25,500,0,525
) ON CONFLICT DO NOTHING;
INSERT INTO loyalty_ledger_entries(
  id,tenant_id,account_id,customer_id,program_id,entry_type,pending_delta,available_delta,
  lifetime_delta,expires_at,policy_snapshot_json,generation_key,created_by_user_id
) SELECT
  'c8000000-0000-4000-8000-000000000202','10000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000201','60000000-0000-4000-8000-000000000001',lp.id,
  'MIGRATION',0,500,525,now()+interval '365 days','{"fixture":true}'::jsonb,
  'seed:sprint8:loyalty-opening','30000000-0000-4000-8000-000000000002'
FROM loyalty_programs lp
WHERE lp.tenant_id='10000000-0000-4000-8000-000000000001' AND lp.status='ACTIVE'
ORDER BY lp.id LIMIT 1 ON CONFLICT DO NOTHING;
INSERT INTO loyalty_point_lots(
  id,tenant_id,account_id,source_ledger_entry_id,original_points,available_points,expires_at
) VALUES (
  'c8000000-0000-4000-8000-000000000203','10000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000201','c8000000-0000-4000-8000-000000000202',
  500,500,now()+interval '365 days'
) ON CONFLICT DO NOTHING;
INSERT INTO loyalty_adjustment_requests(
  id,tenant_id,customer_id,account_id,points_delta,reason_code,note,status,requested_by_user_id
) VALUES (
  'c8000000-0000-4000-8000-000000000204','10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000201',
  50,'SERVICE_RECOVERY','Deterministic dual-control fixture','PENDING',
  '30000000-0000-4000-8000-000000000016'
) ON CONFLICT DO NOTHING;

INSERT INTO membership_tiers(
  id,tenant_id,code,name_json,qualification_type,qualification_threshold,rolling_window_days,
  benefits_json,status,priority,effective_from,created_by_user_id
) VALUES (
  'c8000000-0000-4000-8000-000000000301','10000000-0000-4000-8000-000000000001','SEED-GOLD',
  '{"vi-VN":"Hạng Vàng","en-US":"Gold"}','ROLLING_SPEND',1000000,365,
  '[{"type":"PERCENT_DISCOUNT","value":500}]','ACTIVE',100,now()-interval '1 day',
  '30000000-0000-4000-8000-000000000002'
) ON CONFLICT DO NOTHING;
INSERT INTO customer_membership_assignments(
  id,tenant_id,customer_id,tier_id,status,effective_from,effective_to,benefit_snapshot_json,
  qualification_snapshot_json,reason_code,assigned_by_user_id
) VALUES (
  'c8000000-0000-4000-8000-000000000302','10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000301',
  'ACTIVE',now()-interval '1 day',now()+interval '365 days','[{"type":"PERCENT_DISCOUNT","value":500}]',
  '{"rollingSpendMinor":1250000}','SEED_QUALIFICATION','30000000-0000-4000-8000-000000000002'
) ON CONFLICT DO NOTHING;
INSERT INTO customer_membership_metrics(
  tenant_id,customer_id,rolling_spend_minor,lifetime_spend_minor,visit_count,points_earned,
  window_started_at,last_evaluated_at
) VALUES (
  '10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
  1250000,2500000,12,525,now()-interval '365 days',now()
) ON CONFLICT DO NOTHING;

INSERT INTO service_package_products(
  id,tenant_id,code,name_json,description_json,status,granted_units,units_per_redemption,
  price_minor,currency,validity_days,refund_policy,policy_json,created_by_user_id
) VALUES (
  'c8000000-0000-4000-8000-000000000401','10000000-0000-4000-8000-000000000001','SEED-MANI-5',
  '{"vi-VN":"Gói 5 lần Manicure","en-US":"5 Manicure Package"}','{"fixture":true}',
  'ACTIVE',5,1,450000,'VND',180,'RESTORE_UNIT','{"transferable":false}',
  '30000000-0000-4000-8000-000000000002'
) ON CONFLICT DO NOTHING;
INSERT INTO service_package_eligibility_items(
  id,tenant_id,package_product_id,service_id,branch_id,units_per_redemption
) VALUES (
  'c8000000-0000-4000-8000-000000000402','10000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000401','50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',1
) ON CONFLICT DO NOTHING;
INSERT INTO customer_package_entitlements(
  id,tenant_id,customer_id,package_product_id,status,granted_units,adjustment_units,
  available_units,reserved_units,consumed_units,allocated_unit_value_minor,currency,
  issued_at,expires_at,policy_snapshot_json,generation_key
) VALUES (
  'c8000000-0000-4000-8000-000000000403','10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000401',
  'ACTIVE',5,0,4,0,1,90000,'VND',now()-interval '30 days',now()+interval '150 days',
  '{"refundPolicy":"RESTORE_UNIT","fixture":true}','seed:sprint8:package:customer1'
) ON CONFLICT DO NOTHING;
INSERT INTO package_ledger_entries(
  id,tenant_id,entitlement_id,customer_id,entry_type,available_delta,consumed_delta,
  policy_snapshot_json,generation_key,created_by_user_id
) VALUES (
  'c8000000-0000-4000-8000-000000000404','10000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000403','60000000-0000-4000-8000-000000000001',
  'ISSUE',4,1,'{"fixture":true}','seed:sprint8:package-opening',
  '30000000-0000-4000-8000-000000000002'
) ON CONFLICT DO NOTHING;

COMMIT;
