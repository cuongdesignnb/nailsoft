# ADR 0058: Gift-card security and tokenization

- Status: Accepted for Sprint 10
- Full card number is HMAC-hashed per tenant; APIs and data views expose only a reference and last four digits. PINs use salted scrypt plus an environment pepper.
- Plain card/PIN credentials are returned once during issuance/replacement and are forbidden from logs, audit, outbox, realtime and exports.
- Lookup is tenant-scoped, rate-limited and locks after repeated PIN failures. Failed-attempt state commits even when the API returns a generic invalid response.
- Production refuses operation without `STORED_VALUE_HMAC_SECRET`; key rotation is represented by key-version columns.
