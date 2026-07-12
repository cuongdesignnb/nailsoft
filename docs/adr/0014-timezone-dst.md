# ADR 0014 — Timezone and DST

- Status: Accepted
- Date: 2026-07-12

## Decision

PostgreSQL stores instants as `timestamptz`; local business rules use the branch IANA timezone. Luxon performs conversions. Device timezone is never authoritative.

Nonexistent local times are skipped and explained as `DST_GAP`. Ambiguous local times are expanded with `getPossibleOffsets()` so distinct instants retain distinct ISO offsets and are not collapsed. API responses include UTC instants, local offset-bearing values and the branch timezone.

## Verification

The test matrix covers `Asia/Ho_Chi_Minh`, `America/New_York`, spring-forward, fall-back, overnight shifts and multi-day leave.
