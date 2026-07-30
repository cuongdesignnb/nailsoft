# ADR 0078: Entitlement and quota enforcement

Status: Accepted. Resolution is emergency override, add-on, plan version, legacy projection, then deny. PostgreSQL projections are authoritative. API/domain/Worker enforce access; UI capability is advisory. Quota-sensitive commands serialize on tenant/quota and count authoritative resources plus reservations. Billing, export, security and support remain available in restricted modes.
