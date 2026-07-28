# Sprint 10 Stored-value API

All commands are authenticated, tenant-scoped, online-only and require `Idempotency-Key`. Monetary values are integer minor-unit strings. Mutations use optimistic `version`; database conflicts map to domain errors rather than HTTP 500.

Surfaces: versioned `/gift-card-products`; masked `/gift-cards` lookup/lifecycle/balance/ledger; POS gift-card funding lines; `/pos-orders/{id}/stored-value` eligibility/reserve/release; customer-credit accounts and dual-control adjustments; refund plan/destination; own-customer wallet; liability/reconciliation reports and exports.

Sensitive inputs (`number`, `pin`) are write-only and redacted before idempotency/audit hashing. Issuance/replacement credentials are display-once. Realtime payloads contain identifiers and `refetch: true` only.

Primary conflicts: `STORED_VALUE_FEATURE_DISABLED`, `GIFT_CARD_INVALID`, `GIFT_CARD_LOCKED`, `GIFT_CARD_NOT_ACTIVE`, `GIFT_CARD_FUNDING_NOT_CAPTURED`, `GIFT_CARD_DISCOUNT_NOT_ALLOWED`, `STORED_VALUE_INSUFFICIENT_BALANCE`, `STORED_VALUE_VERSION_CONFLICT`, `STORED_VALUE_RESERVATION_CONFLICT`, `STORED_VALUE_CUSTOMER_MISMATCH`, `CUSTOMER_CREDIT_SELF_APPROVAL_DENIED`, and `STORED_VALUE_REFUND_ALLOCATION_CONFLICT`.
