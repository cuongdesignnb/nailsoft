# ADR 0022 — Public booking security

- Status: Accepted for Sprint 4
- Date: 2026-07-15

## Decision

Public tenant context is resolved only from the active `salonSlug`. APIs expose active branches, online-bookable services, policy-allowed staff identity, public price and availability. Raw tenant IDs, resource IDs, internal notes and customer data are not accepted as authority or exposed unnecessarily.

Hold and booking-management capabilities are short-lived signed purpose tokens. Management claims bind tenant, appointment, case-insensitive booking reference, contact verification version, purpose and expiry; every request reloads current database state/version. Raw tokens and OTPs are never persisted or logged.

Management access uses neutral reference-plus-contact challenge responses, OTP attempt/expiry controls and rate limits scoped by IP, salon, hashed contact and client key. A booking reference alone never authorizes access.

## Consequences

- Enumeration attempts receive indistinguishable challenge responses.
- Public token revocation is implemented by incrementing the persisted verification version.
- Technician projections mask full phone, email, internal notes and unrelated staff data.
