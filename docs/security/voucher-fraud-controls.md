# Voucher fraud controls

- Plain voucher codes are accepted only at the command boundary, redacted from idempotency/audit input, normalized and HMAC-hashed with tenant binding. APIs return last four characters only.
- Campaign, code, customer, branch, service, tier, time window and monetary thresholds are revalidated at reservation and payment.
- Locked conditional counters and unique active-order reservations prevent limit oversubscription; idempotency binds a key to its request hash.
- Marketing can manage campaigns but cannot redeem at POS. Cashier can redeem but cannot create campaigns. Platform Super Admin is denied without support access.
- Logs, outbox and realtime exclude codes and customer PII. Gateway rate limiting and anomaly alerts remain production configuration work.
