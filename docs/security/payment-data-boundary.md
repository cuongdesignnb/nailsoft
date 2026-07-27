# Payment data boundary

## Allowed evidence

- Tender type, currency and integer minor-unit amounts.
- Opaque provider transaction ID and terminal ID.
- Card brand, last four digits and approval code.
- Redacted, allowlisted evidence note/timestamps.

## Forbidden everywhere

- PAN/full card number, CVV/CVC, PIN, raw expiry/track data.
- Terminal secrets, provider access tokens and unfiltered provider responses.

Zod `.strict()` payment schemas reject unknown fields. Application logging redacts authorization/cookies, financial audit/outbox payloads are constructed from allowlists, and payment attempts store only redacted command/result metadata. Production manual external recording is disabled unless explicitly configured. Webhooks verify the raw body before parsing or storing safe metadata.
