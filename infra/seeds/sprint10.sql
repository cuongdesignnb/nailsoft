BEGIN;

-- Deterministic, non-PII Sprint 10 fixtures. Full card numbers and PINs are never stored.
INSERT INTO stored_value_settings(tenant_id,feature_status)
VALUES('10000000-0000-4000-8000-000000000001','ENABLED')
ON CONFLICT(tenant_id) DO UPDATE
SET feature_status='ENABLED',updated_at=now();

-- Checkout-ready appointment dedicated to the authenticated Gift Card purchase flow.
INSERT INTO service_sessions(
  id,tenant_id,branch_id,appointment_id,appointment_item_id,status,
  scheduled_start_at,scheduled_end_at,actual_started_at,actual_ended_at,
  total_pause_seconds,actual_work_seconds,completion_note,version,
  started_by_user_id,completed_by_user_id
) VALUES (
  'da600000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000035',
  '72000000-0000-4000-8000-000000000035','COMPLETED',
  '2026-07-15 10:00:00+07','2026-07-15 11:00:00+07','2026-07-15 10:00:00+07',
  '2026-07-15 11:00:00+07',0,3600,'Sprint 10 checkout fixture',1,
  '30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'
) ON CONFLICT DO NOTHING;

INSERT INTO stored_value_legal_policies(
  id,tenant_id,jurisdiction,policy_version,status,expiration_mode,breakage_mode,
  legal_review_status,effective_from,created_by_user_id,approved_by_user_id,approved_at
) VALUES (
  'da000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'VN',1,'APPROVED','NO_EXPIRATION','NONE','APPROVED','2026-01-01','30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001','2026-01-01'
) ON CONFLICT DO NOTHING;

INSERT INTO gift_card_products(
  id,tenant_id,product_code,name_json,status,amount_mode,card_form,currency,
  minimum_amount_minor,maximum_amount_minor,fixed_denominations_minor,
  maximum_balance_minor,reloadable,assignment_policy,pin_required,legal_policy_id,
  created_by_user_id
) VALUES (
  'da100000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'GC-DEMO','{"vi-VN":"Thẻ quà tặng Nailsoft","en-US":"Nailsoft Gift Card"}',
  'ACTIVE','FIXED','BOTH','VND',100000,1000000,ARRAY[100000,200000,500000,1000000]::bigint[],
  5000000,true,'BEARER_OR_CUSTOMER',false,'da000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
) ON CONFLICT DO NOTHING;

INSERT INTO gift_cards(
  id,tenant_id,product_id,customer_id,card_reference,number_hash,number_last4,
  form,status,currency,activated_at,policy_snapshot_json
) VALUES
(
  'da200000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
  'GC-SEED-ACTIVE',encode(hmac('10000000-0000-4000-8000-000000000001:4111111111111111','test-only-stored-value-secret-change-in-production','sha256'),'hex'),
  '1111','DIGITAL','ACTIVE','VND','2026-01-01','{"fixture":true,"expirationMode":"NO_EXPIRATION"}'
),
(
  'da200000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',NULL,
  'GC-SEED-SUSPENDED',encode(hmac('10000000-0000-4000-8000-000000000001:4222222222222222','test-only-stored-value-secret-change-in-production','sha256'),'hex'),
  '2222','PHYSICAL','SUSPENDED','VND','2026-01-01','{"fixture":true,"expirationMode":"NO_EXPIRATION"}'
),
(
  'da200000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',NULL,
  'GC-SEED-DEPLETED',encode(hmac('10000000-0000-4000-8000-000000000001:4333333333333333','test-only-stored-value-secret-change-in-production','sha256'),'hex'),
  '3333','DIGITAL','DEPLETED','VND','2026-01-01','{"fixture":true,"expirationMode":"NO_EXPIRATION"}'
)
ON CONFLICT DO NOTHING;

INSERT INTO stored_value_accounts(
  id,tenant_id,account_type,gift_card_id,customer_id,currency,available_minor,redeemed_minor,
  lifetime_issued_minor,lifetime_redeemed_minor
) VALUES
('da300000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','GIFT_CARD','da200000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','VND',500000,0,500000,0),
('da300000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','GIFT_CARD','da200000-0000-4000-8000-000000000002',NULL,'VND',200000,0,200000,0),
('da300000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','GIFT_CARD','da200000-0000-4000-8000-000000000003',NULL,'VND',0,300000,300000,300000),
('da300000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','CUSTOMER_CREDIT',NULL,'60000000-0000-4000-8000-000000000001','VND',300000,0,300000,0)
ON CONFLICT DO NOTHING;

INSERT INTO stored_value_ledger_entries(
  id,tenant_id,account_id,entry_type,available_delta_minor,redeemed_delta_minor,
  currency,policy_snapshot_json,generation_key,actor_user_id,occurred_at
) VALUES
('da400000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','da300000-0000-4000-8000-000000000001','MIGRATION',500000,0,'VND','{"fixture":true}','seed:sprint10:active','30000000-0000-4000-8000-000000000001','2026-01-01'),
('da400000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','da300000-0000-4000-8000-000000000002','MIGRATION',200000,0,'VND','{"fixture":true}','seed:sprint10:suspended','30000000-0000-4000-8000-000000000001','2026-01-01'),
('da400000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','da300000-0000-4000-8000-000000000003','MIGRATION',0,300000,'VND','{"fixture":true}','seed:sprint10:depleted','30000000-0000-4000-8000-000000000001','2026-01-01'),
('da400000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','da300000-0000-4000-8000-000000000004','MIGRATION',300000,0,'VND','{"fixture":true}','seed:sprint10:customer-credit','30000000-0000-4000-8000-000000000001','2026-01-01')
ON CONFLICT DO NOTHING;

INSERT INTO stored_value_adjustment_requests(
  id,tenant_id,customer_id,currency,adjustment_type,amount_minor,reason_code,note,
  status,requested_by_user_id
) VALUES (
  'da500000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','VND','SERVICE_RECOVERY_CREDIT',100000,
  'SERVICE_RECOVERY','Deterministic Sprint 10 dual-control fixture','PENDING',
  '30000000-0000-4000-8000-000000000016'
) ON CONFLICT DO NOTHING;

COMMIT;
