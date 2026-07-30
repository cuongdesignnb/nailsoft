BEGIN;
INSERT INTO tenants(id,name,slug,default_locale,currency,timezone,status,lifecycle_status,access_mode)
VALUES
('13000000-0000-4000-8000-000000000901','Sprint 13 Trial Fixture','sprint13-trial-fixture','en-US','USD','UTC','ACTIVE','ACTIVE','FULL'),
('13000000-0000-4000-8000-000000000902','Sprint 13 Past Due Fixture','sprint13-past-due-fixture','en-US','USD','UTC','ACTIVE','GRACE','GRACE'),
('13000000-0000-4000-8000-000000000903','Sprint 13 Read Only Fixture','sprint13-read-only-fixture','en-US','USD','UTC','ACTIVE','READ_ONLY','READ_ONLY')
ON CONFLICT(id) DO NOTHING;
INSERT INTO users(id,origin_tenant_id,email,display_name,status)
VALUES('13000000-0000-4000-8000-000000000918','10000000-0000-4000-8000-000000000001','platform-billing-approver@example.test','Platform Billing Approver','ACTIVE')
ON CONFLICT(id) DO NOTHING;
INSERT INTO tenant_memberships(id,tenant_id,user_id,status,joined_at)
VALUES('13000000-0000-4000-8000-000000000919','10000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000918','ACTIVE',now())
ON CONFLICT(id) DO NOTHING;
INSERT INTO membership_roles(membership_id,role)
VALUES('13000000-0000-4000-8000-000000000919','PLATFORM_SUPER_ADMIN')
ON CONFLICT(membership_id,role) DO NOTHING;
INSERT INTO platform_billing_accounts(id,tenant_id,legal_name,billing_email,currency,locale,timezone,state,collection_mode,invoice_prefix)
VALUES
('13000000-0000-4000-8000-000000000911','13000000-0000-4000-8000-000000000901','Sprint 13 Trial Fixture',NULL,'USD','en-US','UTC','ACTIVE','MANUAL_INVOICE','S13T'),
('13000000-0000-4000-8000-000000000912','13000000-0000-4000-8000-000000000902','Sprint 13 Past Due Fixture',NULL,'USD','en-US','UTC','DELINQUENT','AUTOMATIC','S13P'),
('13000000-0000-4000-8000-000000000913','13000000-0000-4000-8000-000000000903','Sprint 13 Read Only Fixture',NULL,'USD','en-US','UTC','DELINQUENT','MANUAL_INVOICE','S13R')
ON CONFLICT(tenant_id) DO NOTHING;
INSERT INTO platform_billing_accounts(id,tenant_id,legal_name,billing_email,currency,locale,timezone,state,collection_mode,invoice_prefix)
SELECT gen_random_uuid(),t.id,t.name,NULL,t.currency,t.default_locale,t.timezone,'ACTIVE','DISABLED','LEG-'||upper(substr(replace(t.slug,'-',''),1,8))
FROM tenants t ON CONFLICT(tenant_id) DO NOTHING;
INSERT INTO platform_invoice_number_sequences(billing_account_id)
SELECT id FROM platform_billing_accounts ON CONFLICT(billing_account_id) DO NOTHING;
INSERT INTO platform_subscriptions(id,tenant_id,billing_account_id,product_id,plan_id,plan_version_id,status,collection_mode,current_period_start,current_period_end,trial_started_at,trial_ends_at)
VALUES
('13000000-0000-4000-8000-000000000921','13000000-0000-4000-8000-000000000901','13000000-0000-4000-8000-000000000911','13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000011','13000000-0000-4000-8000-000000000101','TRIALING','MANUAL_INVOICE',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',now(),now()+interval '14 days'),
('13000000-0000-4000-8000-000000000922','13000000-0000-4000-8000-000000000902','13000000-0000-4000-8000-000000000912','13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000012','13000000-0000-4000-8000-000000000102','PAST_DUE','AUTOMATIC',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',NULL,NULL),
('13000000-0000-4000-8000-000000000923','13000000-0000-4000-8000-000000000903','13000000-0000-4000-8000-000000000913','13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000013','13000000-0000-4000-8000-000000000103','READ_ONLY','MANUAL_INVOICE',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',NULL,NULL)
ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_subscriptions(id,tenant_id,billing_account_id,product_id,plan_id,plan_version_id,status,collection_mode,current_period_start,current_period_end)
SELECT gen_random_uuid(),a.tenant_id,a.id,'13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000100','ACTIVE','DISABLED',date_trunc('month',now()),date_trunc('month',now())+interval '100 years'
FROM platform_billing_accounts a WHERE NOT EXISTS(SELECT 1 FROM platform_subscriptions s WHERE s.tenant_id=a.tenant_id AND s.product_id='13000000-0000-4000-8000-000000000001');
INSERT INTO platform_subscription_periods(id,tenant_id,subscription_id,period_start,period_end,billing_timezone,plan_version_id,price_snapshot_json,entitlement_snapshot_json,quota_snapshot_json,fingerprint,locked_at)
SELECT ('13000000-0000-4000-8000-'||lpad((930+row_number() OVER(ORDER BY s.id))::text,12,'0'))::uuid,
       s.tenant_id,s.id,s.current_period_start,s.current_period_end,'UTC',s.plan_version_id,
       jsonb_build_object('unitAmountMinor',p.unit_amount_minor::text,'currency',p.currency,'fixture',true),
       v.entitlement_snapshot_json,v.quota_snapshot_json,encode(digest(s.id::text||':fixture-period','sha256'),'hex'),now()
FROM platform_subscriptions s JOIN platform_plan_versions v ON v.id=s.plan_version_id
JOIN platform_prices p ON p.plan_version_id=v.id AND p.status='ACTIVE'
WHERE s.id IN('13000000-0000-4000-8000-000000000921','13000000-0000-4000-8000-000000000922','13000000-0000-4000-8000-000000000923')
ON CONFLICT(subscription_id,period_start) DO NOTHING;
INSERT INTO platform_subscription_periods(tenant_id,subscription_id,period_start,period_end,billing_timezone,plan_version_id,price_snapshot_json,entitlement_snapshot_json,quota_snapshot_json,fingerprint,locked_at)
SELECT s.tenant_id,s.id,s.current_period_start,s.current_period_end,a.timezone,s.plan_version_id,'{"unitAmountMinor":0,"currency":"USD","collectionMode":"DISABLED"}',
  '{"legacy":true,"allSprint1To12Features":true}','{"unlimited":true}',encode(digest(s.id::text||':legacy','sha256'),'hex'),now()
FROM platform_subscriptions s JOIN platform_billing_accounts a ON a.id=s.billing_account_id
WHERE s.collection_mode='DISABLED' ON CONFLICT(subscription_id,period_start) DO NOTHING;
INSERT INTO platform_subscription_items(id,tenant_id,subscription_id,price_id,quantity,starts_at)
SELECT ('13000000-0000-4000-8000-'||lpad((940+row_number() OVER(ORDER BY s.id))::text,12,'0'))::uuid,
       s.tenant_id,s.id,p.id,1,s.current_period_start
FROM platform_subscriptions s JOIN platform_prices p ON p.plan_version_id=s.plan_version_id AND p.status='ACTIVE'
WHERE s.id IN('13000000-0000-4000-8000-000000000921','13000000-0000-4000-8000-000000000922','13000000-0000-4000-8000-000000000923')
ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_entitlement_projections(tenant_id,entitlement_code,enabled,quota_limit,unlimited,source_type,source_id,fingerprint)
SELECT s.tenant_id,e.entitlement_code,e.enabled,e.quota_limit,e.unlimited,'PLAN_VERSION',s.id,
       encode(digest(s.tenant_id::text||':'||e.entitlement_code||':'||s.plan_version_id::text,'sha256'),'hex')
FROM platform_subscriptions s JOIN platform_plan_entitlements e ON e.plan_version_id=s.plan_version_id
WHERE s.id IN('13000000-0000-4000-8000-000000000921','13000000-0000-4000-8000-000000000922','13000000-0000-4000-8000-000000000923')
ON CONFLICT(tenant_id,entitlement_code) DO NOTHING;
INSERT INTO platform_entitlement_projections(tenant_id,entitlement_code,enabled,quota_limit,unlimited,source_type,source_id,fingerprint)
SELECT s.tenant_id,d.code,CASE WHEN d.kind='FEATURE' THEN true END,NULL,d.kind='QUOTA','LEGACY_MIGRATION',s.id,encode(digest(s.tenant_id::text||':'||d.code||':legacy','sha256'),'hex')
FROM platform_subscriptions s CROSS JOIN platform_entitlement_definitions d WHERE s.collection_mode='DISABLED'
ON CONFLICT(tenant_id,entitlement_code) DO NOTHING;

INSERT INTO tenant_onboarding_checklists(tenant_id,item_code,status,completed_at,evidence_json)
SELECT id,item,'COMPLETED',now(),'{"fixture":"deterministic","pii":false}'::jsonb
FROM tenants CROSS JOIN unnest(ARRAY['OWNER_IDENTITY','DEFAULT_BRANCH','BILLING_ACCOUNT','SUBSCRIPTION']) item
ON CONFLICT(tenant_id,item_code) DO NOTHING;

INSERT INTO platform_usage_aggregates(id,tenant_id,meter_id,period_start,period_end,quantity,fingerprint)
SELECT '13000000-0000-4000-8000-000000000801',t.id,m.id,date_trunc('month',now()),date_trunc('month',now())+interval '1 month',12,
       encode(digest(t.id::text||':BOOKING_CREATED:fixture','sha256'),'hex')
FROM tenants t JOIN platform_usage_meter_definitions m ON m.code='BOOKING_CREATED'
WHERE t.slug='nailsoft-demo' ON CONFLICT(tenant_id,meter_id,period_start) DO NOTHING;

INSERT INTO platform_payment_methods(id,tenant_id,billing_account_id,provider,provider_reference,method_type,display_json,status)
SELECT '13000000-0000-4000-8000-000000000802',a.tenant_id,a.id,'FAKE','pm_sprint13_fixture','CARD_TOKEN','{"brand":"TEST","last4":"4242","testOnly":true}','ACTIVE'
FROM platform_billing_accounts a JOIN tenants t ON t.id=a.tenant_id WHERE t.slug='nailsoft-demo'
ON CONFLICT(provider,provider_reference) DO NOTHING;

UPDATE platform_billing_accounts a SET default_payment_method_id='13000000-0000-4000-8000-000000000802'
FROM tenants t WHERE t.id=a.tenant_id AND t.slug='nailsoft-demo' AND a.default_payment_method_id IS NULL;

INSERT INTO platform_payment_methods(id,tenant_id,billing_account_id,provider,provider_reference,method_type,display_json,status)
VALUES('13000000-0000-4000-8000-000000000951','13000000-0000-4000-8000-000000000902','13000000-0000-4000-8000-000000000912','FAKE','pm_sprint13_past_due','CARD_TOKEN','{"brand":"TEST","last4":"0002","testOnly":true}','ACTIVE')
ON CONFLICT(provider,provider_reference) DO NOTHING;
UPDATE platform_billing_accounts SET default_payment_method_id='13000000-0000-4000-8000-000000000951'
WHERE id='13000000-0000-4000-8000-000000000912' AND default_payment_method_id IS NULL;

INSERT INTO platform_invoices(id,tenant_id,billing_account_id,subscription_id,subscription_period_id,status,currency,subtotal_minor,total_minor,paid_minor,due_at)
SELECT '13000000-0000-4000-8000-000000000952',s.tenant_id,s.billing_account_id,s.id,p.id,'DRAFT','USD',9900,9900,0,now()-interval '7 days'
FROM platform_subscriptions s JOIN platform_subscription_periods p ON p.subscription_id=s.id
WHERE s.id='13000000-0000-4000-8000-000000000922' ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_invoice_lines(id,tenant_id,invoice_id,line_type,description,quantity,unit_amount_minor,total_minor,source_type,snapshot_json)
VALUES('13000000-0000-4000-8000-000000000953','13000000-0000-4000-8000-000000000902','13000000-0000-4000-8000-000000000952','BASE_PLAN','Growth monthly fixture',1,9900,9900,'SUBSCRIPTION_PERIOD','{"fixture":true}')
ON CONFLICT(id) DO NOTHING;
UPDATE platform_invoices SET invoice_number='S13P-00000001',status='PAST_DUE',finalized_at=now()-interval '21 days',fingerprint=encode(digest('s13-past-due-invoice','sha256'),'hex')
WHERE id='13000000-0000-4000-8000-000000000952' AND finalized_at IS NULL;
UPDATE platform_subscription_periods SET invoice_id='13000000-0000-4000-8000-000000000952'
WHERE subscription_id='13000000-0000-4000-8000-000000000922' AND invoice_id IS NULL;
INSERT INTO platform_payment_intents(id,tenant_id,invoice_id,payment_method_id,amount_minor,currency,status,provider,provider_key,provider_reference)
VALUES('13000000-0000-4000-8000-000000000954','13000000-0000-4000-8000-000000000902','13000000-0000-4000-8000-000000000952','13000000-0000-4000-8000-000000000951',9900,'USD','FAILED','FAKE','platform-payment:fixture-past-due','fake_failed_fixture')
ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_dunning_cases(id,tenant_id,invoice_id,policy_id,status,current_stage,next_action_at,generation_key)
SELECT '13000000-0000-4000-8000-000000000955','13000000-0000-4000-8000-000000000902','13000000-0000-4000-8000-000000000952',id,'OPEN','GRACE_STARTED',now()+interval '3 days','fixture:past-due:dunning'
FROM platform_dunning_policies WHERE code='DEFAULT_EMAIL_ONLY' ON CONFLICT(generation_key) DO NOTHING;

INSERT INTO platform_billing_credit_ledger(id,tenant_id,billing_account_id,entry_type,amount_minor,currency,source_type,source_id,evidence_json)
VALUES('13000000-0000-4000-8000-000000000956','13000000-0000-4000-8000-000000000903','13000000-0000-4000-8000-000000000913','MANUAL_CREDIT',500,'USD','SEED','13000000-0000-4000-8000-000000000956','{"fixture":true,"pii":false}')
ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_invoices(id,tenant_id,billing_account_id,subscription_id,status,currency,subtotal_minor,total_minor,paid_minor,refunded_minor,due_at)
VALUES('13000000-0000-4000-8000-000000000960','13000000-0000-4000-8000-000000000903','13000000-0000-4000-8000-000000000913','13000000-0000-4000-8000-000000000923','DRAFT','USD',19900,19900,19900,1000,now()-interval '30 days')
ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_invoice_lines(id,tenant_id,invoice_id,line_type,description,quantity,unit_amount_minor,total_minor,source_type,snapshot_json)
VALUES('13000000-0000-4000-8000-000000000961','13000000-0000-4000-8000-000000000903','13000000-0000-4000-8000-000000000960','BASE_PLAN','Pro monthly paid fixture',1,19900,19900,'SUBSCRIPTION_PERIOD','{"fixture":true}')
ON CONFLICT(id) DO NOTHING;
UPDATE platform_invoices SET invoice_number='S13R-00000001',status='PAID',finalized_at=now()-interval '30 days',fingerprint=encode(digest('s13-paid-invoice','sha256'),'hex')
WHERE id='13000000-0000-4000-8000-000000000960' AND finalized_at IS NULL;
INSERT INTO platform_payment_intents(id,tenant_id,invoice_id,amount_minor,currency,status,provider,provider_key,provider_reference)
VALUES('13000000-0000-4000-8000-000000000962','13000000-0000-4000-8000-000000000903','13000000-0000-4000-8000-000000000960',19900,'USD','PARTIALLY_REFUNDED','FAKE','platform-payment:fixture-paid-refund','fake_paid_fixture')
ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_refunds(id,tenant_id,payment_intent_id,amount_minor,currency,status,reason,evidence_json,provider_key,provider_reference,requested_by_user_id,approved_by_user_id)
VALUES('13000000-0000-4000-8000-000000000963','13000000-0000-4000-8000-000000000903','13000000-0000-4000-8000-000000000962',1000,'USD','SUCCEEDED','Deterministic partial refund fixture','{"fixture":true,"pii":false}','platform-refund:fixture-partial','fake_refund_fixture','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002')
ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_entitlement_overrides(id,tenant_id,entitlement_code,enabled,reason,ticket_reference,starts_at,expires_at,approved_by_user_id,created_by_user_id)
VALUES('13000000-0000-4000-8000-000000000957','13000000-0000-4000-8000-000000000903','marketing.enabled',true,'Deterministic QA fixture','QA-S13-OVERRIDE',now()-interval '1 hour',now()+interval '7 days','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002')
ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_support_access_grants(id,tenant_id,support_user_id,tenant_approver_user_id,state,ticket_reference,reason,permission_scope_json,branch_scope_json,data_classification_scope_json,starts_at,expires_at,session_ttl_seconds,requested_by_user_id,approved_at)
VALUES('13000000-0000-4000-8000-000000000958','13000000-0000-4000-8000-000000000901','30000000-0000-4000-8000-000000000015','30000000-0000-4000-8000-000000000001','ACTIVE','QA-S13-SUPPORT','Deterministic scoped support fixture','["appointment.read"]','[]','["OPERATIONAL"]',now()-interval '5 minutes',now()+interval '1 hour',600,'30000000-0000-4000-8000-000000000015',now()-interval '5 minutes')
ON CONFLICT(id) DO NOTHING;
INSERT INTO platform_support_sessions(id,tenant_id,grant_id,support_user_id,token_hash,state,expires_at)
VALUES('13000000-0000-4000-8000-000000000959','13000000-0000-4000-8000-000000000901','13000000-0000-4000-8000-000000000958','30000000-0000-4000-8000-000000000015',encode(digest('sprint13-fixture-session-token','sha256'),'hex'),'ACTIVE',now()+interval '10 minutes')
ON CONFLICT(id) DO NOTHING;
COMMIT;
