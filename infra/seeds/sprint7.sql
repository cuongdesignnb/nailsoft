BEGIN;

UPDATE branch_settings SET tax_policy_json=tax_policy_json||'{"refundPolicy":{"refundWindowDays":30,"managerApprovalLimitMinor":5000000,"requireDualControl":true,"allowTipRefund":true,"allowTenderSubstitution":false}}'::jsonb
WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND branch_id='20000000-0000-4000-8000-000000000001';

INSERT INTO commission_rules(id,tenant_id,branch_id,rule_code,rule_type,base_mode,percent_basis_points,priority,policy_json,effective_from,status,created_by_user_id) VALUES
('b1000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','DEFAULT-SERVICE-10','SERVICE_PERCENT','NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX',1000,10,'{"fixture":true}',date_trunc('year',now()),'ACTIVE','30000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO commission_periods(id,tenant_id,code,start_date,end_date,status,currency) VALUES
('b2000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','SEED-OPEN-01',CURRENT_DATE-6,CURRENT_DATE+7,'OPEN','VND')
ON CONFLICT DO NOTHING;

INSERT INTO refund_counters(tenant_id,branch_id,fiscal_year,prefix,last_number) VALUES
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',extract(year from now())::integer,'RF',1)
ON CONFLICT(tenant_id,branch_id,fiscal_year) DO UPDATE SET last_number=GREATEST(refund_counters.last_number,1);

INSERT INTO refunds(id,tenant_id,branch_id,invoice_id,pos_order_id,refund_reference,status,currency,requested_minor,service_refund_minor,tax_refund_minor,tip_refund_minor,reason_code,reason_text,policy_snapshot_json,requested_by_user_id) VALUES
('b3000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000004','RF-Q1-SEED-000001','PENDING_APPROVAL','VND',20000,20000,0,0,'SERVICE_QUALITY','Deterministic Sprint 7 approval fixture','{"requireDualControl":true,"allowTenderSubstitution":false}','30000000-0000-4000-8000-000000000016')
ON CONFLICT DO NOTHING;
INSERT INTO refund_items(id,tenant_id,refund_id,item_type,invoice_line_id,quantity,gross_refund_minor,discount_reversal_minor,taxable_refund_minor,tax_refund_minor,tip_refund_minor,total_refund_minor,source_snapshot_json) VALUES
('b4000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','INVOICE_LINE','aa000000-0000-4000-8000-000000000001',0.2,20000,0,20000,0,0,20000,'{"fixture":true,"description":{"name":"Paid service"}}')
ON CONFLICT DO NOTHING;
INSERT INTO refund_payment_allocations(id,tenant_id,refund_id,original_payment_id,tender_type,planned_minor,refund_register_id,cash_session_id,status) VALUES
('b5000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000003','CASH',20000,'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','PLANNED')
ON CONFLICT DO NOTHING;
INSERT INTO refund_status_history(id,tenant_id,refund_id,from_status,to_status,actor_user_id,actor_type,reason_code,note,request_id) VALUES
('b6000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','DRAFT','PENDING_APPROVAL','30000000-0000-4000-8000-000000000016','USER','SERVICE_QUALITY','Deterministic Sprint 7 fixture','seed:sprint7')
ON CONFLICT DO NOTHING;

COMMIT;
