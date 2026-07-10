# ADR 0003: Idempotency

- Status: Accepted
- Decision: Critical commands require `Idempotency-Key`. In the same PostgreSQL transaction, insert `(tenant_id,key,request_hash)`, lock it, run once, and persist the response. Same key/different hash returns 409; matching completed requests replay the response.
- Consequences: Booking, payment, refund, voucher, package and inventory never depend on Redis deduplication. In-progress collisions return retryable 409/425. Expiry cleanup is asynchronous and auditable.
