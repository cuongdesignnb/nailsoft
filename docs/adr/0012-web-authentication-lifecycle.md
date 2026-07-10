# ADR 0012: Web authentication lifecycle

- Status: Accepted for Sprint 1
- Decision: Web refresh tokens use rotated `HttpOnly`, `SameSite=Lax` cookies (`Secure` in production). The access token remains in JavaScript memory only and is restored through refresh after reload. A readable random CSRF cookie must match `X-CSRF-Token` on cookie-based refresh.
- Mobile: Native apps continue to receive the refresh token in the response and store it using platform Secure Store.
- Consequences: No access or refresh token is written to local/session storage. Logout revokes the current server session and clears cookies. Remote revocation invalidates subsequent access through the session guard.
