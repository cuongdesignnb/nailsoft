# Sprint 11 Customer Engagement API Draft

All authenticated routes require tenant context, granular permission and branch scope where applicable. Commands require `Idempotency-Key`; versioned aggregates return `VERSION_CONFLICT` on stale writes.

## Communication

- `GET /v1/customer/me/communication-preferences`
- `POST /v1/customer/me/communication-preferences/update`
- `GET /v1/customer/me/consents`
- `POST /v1/customer/me/consents/grant|withdraw`
- CRUD/lifecycle under `/v1/communications/templates`, `/rules`, `/messages`
- `POST /v1/communications/messages/{id}/retry`
- `GET /v1/internal-notifications`
- `POST /v1/public/unsubscribe` (signed token, public)

## Marketing

- CRUD/preview `/v1/customer-segments`
- CRUD and explicit `submit`, `approve`, `schedule`, `start`, `pause`, `resume`, `cancel` commands under `/v1/marketing-campaigns`
- `/audience` and `/report` are privacy-safe reads.

## Reviews and recovery

- Public `GET /v1/public/reviews/request` and `POST /v1/public/reviews` use signed tokens.
- Authenticated review request/moderation/response routes use `/v1/review-requests` and `/v1/reviews`.
- Recovery case, task, contact and compensation commands use `/v1/service-recovery`.
- `GET /v1/customers/{id}/engagement-timeline` returns scoped, redacted evidence.

Errors include `CONSENT_DEFINITION_NOT_ACTIVE`, `MARKETING_CONSENT_REQUIRED`, `CAMPAIGN_SELF_APPROVAL_DENIED`, `REVIEW_TRANSACTION_NOT_VERIFIED`, `REVIEW_ALREADY_SUBMITTED`, `RECOVERY_STATUS_INVALID`, `RECOVERY_COMPENSATION_SELF_APPROVAL_DENIED`, `VERSION_CONFLICT` and standard authorization/not-found errors.
