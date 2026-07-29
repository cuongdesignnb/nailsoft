# Sprint 11 ERD

```mermaid
erDiagram
  CUSTOMER ||--|| CUSTOMER_COMMUNICATION_PREFERENCE : has
  CUSTOMER ||--o{ CUSTOMER_CONSENT_EVENT : records
  CUSTOMER ||--o{ CUSTOMER_CONSENT_STATE : projects
  CONSENT_DEFINITION ||--o{ CUSTOMER_CONSENT_EVENT : evidences
  COMMUNICATION_TEMPLATE ||--o{ COMMUNICATION_TEMPLATE_VERSION : versions
  COMMUNICATION_TEMPLATE_VERSION ||--o{ COMMUNICATION_MESSAGE : renders
  COMMUNICATION_MESSAGE ||--o{ COMMUNICATION_DELIVERY_ATTEMPT : attempts
  COMMUNICATION_MESSAGE ||--o| MARKETING_FREQUENCY_RESERVATION : leases
  CUSTOMER ||--o{ COMMUNICATION_SUPPRESSION_GENERATION : versions
  CUSTOMER_SEGMENT ||--o{ MARKETING_CAMPAIGN : targets
  MARKETING_CAMPAIGN ||--o{ MARKETING_CAMPAIGN_AUDIENCE : snapshots
  CUSTOMER ||--o{ MARKETING_CAMPAIGN_AUDIENCE : includes
  APPOINTMENT ||--o| REVIEW_REQUEST : qualifies
  INVOICE ||--o| REVIEW_REQUEST : settles
  REVIEW_REQUEST ||--o| CUSTOMER_REVIEW : verifies
  CUSTOMER_REVIEW ||--o{ CUSTOMER_REVIEW_REVISION : histories
  CUSTOMER_REVIEW ||--o| SERVICE_RECOVERY_CASE : triggers
  SERVICE_RECOVERY_CASE ||--o{ SERVICE_RECOVERY_HISTORY : histories
  SERVICE_RECOVERY_CASE ||--o{ SERVICE_RECOVERY_TASK : tasks
  SERVICE_RECOVERY_CASE ||--o{ SERVICE_RECOVERY_CONTACT : contacts
  SERVICE_RECOVERY_CASE ||--o{ SERVICE_RECOVERY_COMPENSATION : proposes
  SERVICE_RECOVERY_COMPENSATION }o--o| CUSTOMER_CREDIT_ADJUSTMENT : synchronizes
  SERVICE_RECOVERY_COMPENSATION }o--o| LOYALTY_ADJUSTMENT : synchronizes
```

Migration `0022_sprint11_engagement_correctness_hardening` adds leased message claims, consent/preference/suppression snapshots, expiring frequency reservations, campaign terminal counters, delayed review-request policy fields and recovery-compensation synchronization evidence. Every business table carries `tenant_id`; branch-operational records also carry a composite branch foreign key. Ledgers/history are append-only. PostgreSQL is authoritative.
