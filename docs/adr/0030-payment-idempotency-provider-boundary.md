# ADR 0030 — Payment idempotency and provider boundary

- Status: Accepted for Sprint 6
- Date: 2026-07-27

## Decision

Payment commands execute inside the order transaction under actor/command/idempotency scope. The transaction locks the order, rereads due, writes immutable payment/attempt/allocation evidence, updates cash movement when needed, and issues the final invoice exactly once. Provider transaction IDs are tenant/provider unique.

The provider interface supports authorize, capture, cancel and verified webhook. Sprint 6 enables cash and permissioned manual external evidence. Production fake success is forbidden. Real terminal mode stays disabled until credentials/hardware are configured.

Strict request schemas reject unknown card fields. PAN, CVV, PIN, track data, secrets and raw provider responses are never persisted, logged, audited or emitted. Webhooks require a raw-body HMAC, timestamp tolerance and unique provider event ID.
