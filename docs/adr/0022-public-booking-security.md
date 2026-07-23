# ADR 0022 — Public booking security

- Status: Accepted for Sprint 4
- Date: 2026-07-15

## Decision

Public tenant context is resolved only from the active `salonSlug`, including every booking-management route. APIs expose active branches, online-bookable services, policy-allowed staff identity, public price and availability. Raw tenant IDs, resource IDs, internal notes and customer data are not accepted as authority or exposed unnecessarily. Public appointment creation has a strict schema that cannot accept `customerId` or internal-only fields.

Hold and booking-management capabilities are short-lived signed purpose tokens. Management claims bind tenant, appointment, case-insensitive booking reference, contact verification version, purpose and expiry; every request reloads current database state/version before idempotency replay. Idempotency actor scopes are derived from verified capability subjects. Raw capability tokens and OTPs are never logged; queued OTP delivery payloads are encrypted at rest with a key derived from the production OTP pepper.

Management access uses neutral reference-plus-contact challenge responses, OTP attempt/expiry controls and PostgreSQL-backed rate limits scoped by IP, salon, hashed contact, verified appointment and client key. OTP delivery is a durable worker job with bounded retry. Production public booking fails at startup unless the OTP pepper and provider configuration are present. A booking reference alone never authorizes access.

## Consequences

- Enumeration attempts receive indistinguishable challenge responses.
- Public token revocation is implemented by incrementing the persisted verification version.
- Technician projections mask full phone, email, internal notes and unrelated staff data.
