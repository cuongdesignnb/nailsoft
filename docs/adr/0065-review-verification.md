# ADR 0065 — Review Verification

Status: Accepted for Sprint 11.

## Decision

Review requests are generated only for completed appointments whose linked order is paid and invoice issued. Public access uses short-lived HMAC-signed tokens; only a token hash is stored. Submission revalidates the paid visit in the same transaction and enforces one review per appointment and request.

Ratings and revisions are append-only evidence. A low verified rating creates exactly one recovery case using a policy-versioned generation key.

## Consequences

Anonymous or transaction-unverified reviews are outside Sprint 11. Public responses never expose customer contact details.
