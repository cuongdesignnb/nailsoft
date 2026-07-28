# ADR 0059: Stored-value expiration and legal policy

- Status: Accepted for Sprint 10
- Safe default is `NO_EXPIRATION`. Fixed/date/activity modes, grace, notices, dormancy and breakage are versioned policy data, not hard-coded country rules.
- Approved jurisdiction windows cannot overlap. Approval is dual-control and snapshots the policy onto issuance.
- No Worker may expire, forfeit, destroy value or recognize breakage unless the referenced legal policy version is approved.
- Jurisdiction rollout requires Legal/Product approval; unsupported regions remain no-expiration.

## Closure amendment

Issuance now loads the exact effective `APPROVED` and legally reviewed policy; a product referencing any other state fails closed. Activation calculates `expires_at` from fixed date, activation-day or last-activity mode plus grace. Replacement copies the exact expiry and legal snapshot, while reload refreshes expiry only for the approved last-activity mode. No automatic breakage posting was introduced.
