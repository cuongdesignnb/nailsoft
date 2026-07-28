# ADR 0053: Inventory worker and realtime

Inventory maintenance uses PostgreSQL leases and `FOR UPDATE SKIP LOCKED`. Each claimed job runs independently with bounded retries and safe dead-letter metadata. Outbox payloads contain identifiers only. Realtime emits branch/tenant refetch signals; PostgreSQL remains the source of truth.
