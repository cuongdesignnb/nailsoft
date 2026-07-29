BEGIN;

-- Deterministic, non-PII Sprint 11 fixtures. Outbound delivery remains FAKE in local QA only.
INSERT INTO communication_settings(tenant_id,email_provider_mode)
VALUES('10000000-0000-4000-8000-000000000001','FAKE')
ON CONFLICT(tenant_id) DO UPDATE SET email_provider_mode='FAKE',updated_at=now();

INSERT INTO consent_definitions(id,tenant_id,purpose,definition_version,locale,consent_text,consent_text_hash,status,effective_from,created_by_user_id) VALUES
('e6000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','MARKETING_EMAIL',1,'vi-VN','Tôi đồng ý nhận email ưu đãi.','seed-marketing-v1','ACTIVE','2026-01-01','30000000-0000-4000-8000-000000000001'),
('e6000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','REVIEW_REQUEST',1,'vi-VN','Tôi đồng ý nhận yêu cầu đánh giá sau dịch vụ.','seed-review-v1','ACTIVE','2026-01-01','30000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

UPDATE customer_communication_preferences SET email_address='customer1@example.test',email_status='VERIFIED',marketing_email_allowed=true,review_request_allowed=true WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND customer_id='60000000-0000-4000-8000-000000000001';
UPDATE customer_communication_preferences SET email_address='customer15@example.test',email_status='VERIFIED',review_request_allowed=true WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND customer_id='60000000-0000-4000-8000-000000000015';

INSERT INTO customer_consent_events(id,tenant_id,customer_id,purpose,event_type,resulting_state,consent_definition_id,definition_version,consent_text_hash,source,actor_user_id,evidence_redacted_json,request_id,generation_key,occurred_at) VALUES
('e7000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','MARKETING_EMAIL','GRANT','GRANTED','e6000000-0000-4000-8000-000000000001',1,'seed-marketing-v1','CUSTOMER_PORTAL','30000000-0000-4000-8000-000000000001','{"fixture":true}','seed:sprint11:marketing-consent','seed:sprint11:marketing-consent','2026-07-01'),
('e7000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000015','REVIEW_REQUEST','GRANT','GRANTED','e6000000-0000-4000-8000-000000000002',1,'seed-review-v1','CUSTOMER_PORTAL','30000000-0000-4000-8000-000000000001','{"fixture":true}','seed:sprint11:review-consent','seed:sprint11:review-consent','2026-07-01')
ON CONFLICT DO NOTHING;
UPDATE customer_consent_states s SET state='GRANTED',last_event_id=e.id,version=version+1,updated_at=now() FROM customer_consent_events e WHERE s.tenant_id=e.tenant_id AND s.customer_id=e.customer_id AND s.purpose=e.purpose AND e.id IN('e7000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000002');

INSERT INTO communication_templates(id,tenant_id,code,category,status,created_by_user_id) VALUES
('e8000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','APPOINTMENT_REMINDER','TRANSACTIONAL','ACTIVE','30000000-0000-4000-8000-000000000001'),
('e8000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','MARKETING_WELCOME','MARKETING','ACTIVE','30000000-0000-4000-8000-000000000001'),
('e8000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','REVIEW_REQUEST','ENGAGEMENT','ACTIVE','30000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO communication_template_versions(id,tenant_id,template_id,version_number,locale,subject,html_body,plain_text_body,allowed_variables_json,required_variables_json,compliance_footer,content_hash,status,effective_from,created_by_user_id) VALUES
('e8100000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001',1,'vi-VN','Nhắc lịch {{bookingReference}}','<p>Lịch hẹn {{bookingReference}} lúc {{startAt}}</p>','Lịch hẹn {{bookingReference}} lúc {{startAt}}','["bookingReference","startAt"]','["bookingReference","startAt"]',NULL,'seed-reminder-v1','ACTIVE','2026-01-01','30000000-0000-4000-8000-000000000001'),
('e8100000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000002',1,'vi-VN','Ưu đãi dành cho bạn','<p>Khám phá ưu đãi mới.</p>','Khám phá ưu đãi mới.','[]','[]','Hủy đăng ký: {{unsubscribeUrl}}','seed-marketing-v1','ACTIVE','2026-01-01','30000000-0000-4000-8000-000000000001'),
('e8100000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000003',1,'vi-VN','Chia sẻ trải nghiệm của bạn','<p>Đánh giá dịch vụ: {{reviewUrl}}</p>','Đánh giá dịch vụ: {{reviewUrl}}','["customerName","reviewUrl"]','["reviewUrl"]',NULL,'seed-review-request-v1','ACTIVE','2026-01-01','30000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO communication_rules(id,tenant_id,branch_id,domain_event,purpose,template_version_id,delay_seconds,status) VALUES
('e8200000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','appointment.confirmed','APPOINTMENT_REMINDER','e8100000-0000-4000-8000-000000000001',0,'ACTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO customer_segments(id,tenant_id,branch_id,name,filter_json,status,version,created_by_user_id) VALUES
('e9000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Consented demo customers','{"marketingConsent":true,"locale":"vi-VN"}','ACTIVE',1,'30000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO marketing_campaigns(id,tenant_id,branch_id,segment_id,template_version_id,name,campaign_type,risk_level,status,requested_by_user_id,audience_generation) VALUES
('e9100000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000002','July welcome fixture','PROMOTION','STANDARD','PENDING_APPROVAL','30000000-0000-4000-8000-000000000004',1)
ON CONFLICT DO NOTHING;
INSERT INTO marketing_campaign_audience(id,tenant_id,campaign_id,customer_id,generation,consent_event_id,contact_hash,contact_reference,locale,timezone,segment_version,eligibility_snapshot_json) VALUES
('e9200000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',1,'e7000000-0000-4000-8000-000000000001','seed-contact-hash','customer1@example.test','vi-VN','Asia/Ho_Chi_Minh',1,'{"fixture":true,"consentState":"GRANTED"}')
ON CONFLICT DO NOTHING;

-- Verified paid transaction dedicated to review-request eligibility.
INSERT INTO pos_orders(id,tenant_id,branch_id,register_id,appointment_id,customer_id,order_number,source,status,currency,subtotal_minor,discount_minor,taxable_minor,tax_minor,total_minor,tip_minor,amount_paid_minor,amount_due_minor,pricing_snapshot_json,tax_snapshot_json,customer_snapshot_json,appointment_snapshot_json,pricing_locked_at,finalized_at,paid_at,created_by_user_id,updated_by_user_id) VALUES
('e1000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000035','60000000-0000-4000-8000-000000000015','POS-S11-REVIEW','APPOINTMENT','PAID','VND',110000,0,0,0,110000,0,110000,0,'{"fixture":true}','{}','{"displayName":"Review Customer"}','{"bookingReference":"S11-REVIEW"}',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days','30000000-0000-4000-8000-000000000016','30000000-0000-4000-8000-000000000016')
ON CONFLICT DO NOTHING;
INSERT INTO invoices(id,tenant_id,branch_id,pos_order_id,invoice_number,status,currency,subtotal_minor,discount_minor,taxable_minor,tax_minor,total_minor,tip_minor,paid_minor,customer_snapshot_json,branch_snapshot_json,tax_snapshot_json,issued_at,issued_by_user_id) VALUES
('e2000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Q1-S11-000001','ISSUED','VND',110000,0,0,0,110000,0,110000,'{"displayName":"Review Customer"}','{"code":"Q1"}','{}',now()-interval '2 days','30000000-0000-4000-8000-000000000016')
ON CONFLICT DO NOTHING;
INSERT INTO review_requests(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,token_hash,expires_at,status,generation_key,sent_at) VALUES
('e3000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000015','70000000-0000-4000-8000-000000000035','e2000000-0000-4000-8000-000000000001',encode(digest('sprint11-review-token','sha256'),'hex'),now()+interval '30 days','SENT','review:invoice:e2000000-0000-4000-8000-000000000001',now()-interval '1 day')
ON CONFLICT DO NOTHING;

INSERT INTO service_recovery_cases(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,source,severity,category,summary,status,assigned_user_id,branch_timezone,sla_policy_version,first_response_due_at,resolution_due_at,generation_key) VALUES
('e5000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000015','70000000-0000-4000-8000-000000000035','e2000000-0000-4000-8000-000000000001','MANUAL','HIGH','CUSTOMER_EXPERIENCE','Deterministic recovery fixture','OPEN','30000000-0000-4000-8000-000000000005','Asia/Ho_Chi_Minh',1,now()+interval '2 hours',now()+interval '24 hours','seed:sprint11:recovery')
ON CONFLICT DO NOTHING;
INSERT INTO service_recovery_history(tenant_id,case_id,to_status,actor_user_id,request_id) SELECT '10000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','OPEN','30000000-0000-4000-8000-000000000001','seed:sprint11' WHERE NOT EXISTS(SELECT 1 FROM service_recovery_history WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND case_id='e5000000-0000-4000-8000-000000000001');
INSERT INTO service_recovery_tasks(id,tenant_id,case_id,task_type,assigned_user_id,status,due_at,note) VALUES
('e5100000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','FOLLOW_UP','30000000-0000-4000-8000-000000000005','OPEN',now()+interval '4 hours','Non-PII follow-up fixture')
ON CONFLICT DO NOTHING;

COMMIT;
