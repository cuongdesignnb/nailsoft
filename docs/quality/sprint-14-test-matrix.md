# Sprint 14 test matrix

| Area | Required evidence | Current status |
|---|---|---|
| Migration 0030 | fresh, rollback to 0029, re-migrate | Local PASS; CI lane added |
| Double-entry and immutability | PostgreSQL trigger tests | Pending Docker/CI |
| Idempotency/concurrency | stable source generation and bank allocation cap | PASS targeted integration |
| Tenant/book scope | negative FK/trigger tests | Pending Docker/CI |
| Source adapters | POS, refund, stored value, inventory, payroll/tip, platform expense boundary | Worker mapping/adapter contract implemented; CI lane added |
| Bank reconciliation | CSV checksum, line fingerprint, match cap, close/void dual control | PASS targeted integration; CI lane added |
| Financial statements | opening/period/closing TB, P&L bridge, BS equation, immutable snapshot transitions | Implemented; CI lane added |
| Authenticated E2E/UI | Accountant submit, self-approval denial, Owner approval and posting | Playwright E2E added; CI lane added |
