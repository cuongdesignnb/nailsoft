# ADR 0006: Offline synchronization

- Status: Accepted
- Decision: Mobile keeps a durable local operation queue with UUID `operationId`, base version and device time. Sync uses operation id as idempotency key. Notes and benign UI states may commit optimistically; booking, finance, redemption and inventory await server confirmation.
- Consequences: 409 refetches and exposes conflict resolution; 422 rolls back with policy context. Ordered retries use exponential backoff. Tokens use platform secure storage; cached personal data is minimized and encrypted.
