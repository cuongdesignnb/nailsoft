# ADR 0067 — Email Provider Boundary

Status: Accepted for Sprint 11.

## Decision

`EmailProvider` is the sole outbound boundary. `DISABLED` fails closed, `FAKE` is deterministic local/CI evidence and `PRODUCTION` requires explicit credentials. Customer channels other than `EMAIL` are rejected by database constraints and validation.

Provider calls happen after a durable claim. Safe provider identifiers and error codes may be persisted; bodies, full addresses, tokens and secrets may not be logged. Fake delivery can return `SENT` but cannot claim `DELIVERED`.

## Consequences

Production provider/webhook integration remains replaceable without changing domain state machines.
