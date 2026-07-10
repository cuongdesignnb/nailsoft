# Sprint 0 discovery record

## Event storming outcomes

- Booking: slot searched → slot held → booking confirmed/rescheduled/cancelled → hold expired. Conflict protection is transactional; price/duration snapshot on confirmation.
- POS/payment: service completed → invoice opened → totals calculated → payment authorized/completed/failed → invoice paid. Payment retry replays by idempotency key.
- Commission: service/payment completed → commission entry drafted → period reviewed/locked/paid. Refund after lock creates an adjustment, never mutation.

## Decisions fixed by SRS

Roles and minimum permissions follow SRS §3. Pricing is effective-dated and snapshotted. Cancellation/deposit rules remain tenant/branch configuration; Sprint 0 does not invent default business values.

## Wireframe contracts

- Calendar: responsive day/week shell, staff columns, filters; loading/empty/error/retry/permission states; optimistic drag shadow with server-confirmed commit.
- POS: cart, totals, split tender and receipt areas; payment action disabled without permission; duplicate submit replays safely.
- Staff Today: cached timeline, connection/sync status, operation cards and conflict recovery.

Detailed visual design is a Sprint 0 product dependency; these interaction contracts avoid changing unapproved business policy.
