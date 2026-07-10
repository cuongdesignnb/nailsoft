# ADR 0002: Authentication

- Status: Accepted
- Decision: Short-lived access JWT plus opaque, hashed, rotating refresh tokens stored in PostgreSQL sessions. Support password and phone OTP adapters; MFA is TOTP/WebAuthn-ready. Roles are tenant/branch scoped and backend-enforced.
- Consequences: Reuse of a rotated refresh token revokes its token family. Login and OTP endpoints are rate-limited. Device/session revocation and sensitive permission changes are audited.
