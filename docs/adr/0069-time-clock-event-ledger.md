# ADR 0069: Time-clock event ledger

Status: Accepted for Sprint 12.

Clock commands append immutable UTC events; server time is authoritative and device time/location are redacted evidence. PostgreSQL uniqueness on tenant/idempotency hash plus an advisory staff lock makes one open session deterministic. Original events are never edited; corrections append approved overlay events. Kiosk devices are branch-bound, secret-hashed, revocable and rate-limit ready. Enforced geofence fails closed when evidence is absent, but IP is never treated as precise location.

Consequences: projections can be rebuilt and audited; clock writes require connectivity; storage grows append-only and requires retention policy review.
