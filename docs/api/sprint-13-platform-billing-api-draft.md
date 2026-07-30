# Sprint 13 platform billing API

All writes require bearer authentication, `Idempotency-Key` and a granular permission. Tenant routes derive tenant identity from claims. Platform routes require platform permissions and explicit target tenant. Monetary fields are bigint minor-unit decimal strings.

Surfaces cover tenant account/plans/subscription/entitlements/usage/invoices/payment methods; catalog/version publication; subscription changes; entitlement overrides/quota reservations; usage/correction; invoice/credit; payment UNKNOWN reconciliation/manual/refund; access modes; support grants/sessions. Generic status PATCH is absent.
