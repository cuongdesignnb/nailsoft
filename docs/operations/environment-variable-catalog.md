# Environment Variable Catalog

Values are injected by the deployment platform or local `.env` only. Never commit credentials.

| Variable | Required | Purpose | Production rule |
|---|---:|---|---|
| `NODE_ENV` | yes | runtime environment | `production` enables fail-closed checks |
| `DATABASE_URL` | yes | PostgreSQL source of truth | TLS/private network recommended |
| `REDIS_URL` | yes | realtime/queue transport and shared rate-limit store | use TLS/authenticated Redis in staging/production |
| `REDIS_REQUIRED` | yes | fail-closed Redis dependency switch | `true` in production |
| `REDIS_RATE_LIMIT_ENABLED` | yes | shared multi-replica HTTP rate-limit store | `true` in production; Redis outage denies requests |
| `JWT_SECRET`, `IDENTITY_HASH_SECRET`, `MFA_ENCRYPTION_KEY` | yes | identity cryptography | non-placeholder, rotated out of band |
| `CORS_ORIGINS` | yes | explicit browser origins | no wildcard with credentials |
| `PUBLIC_URL` | yes | canonical public URL | HTTPS in production |
| `APP_VERSION`, `COMMIT_SHA`, `BUILD_TIMESTAMP` | yes | version endpoint/evidence | immutable per release |
| `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS` | no | database safety limits | tune from load evidence |
| `STORAGE_ENABLED` and `OBJECT_STORAGE_*` | no | private object storage | all credentials required when enabled |
| `OTP_PROVIDER*`, `PAYMENT_PROVIDER_MODE` | no | outbound provider adapters | fake providers forbidden in production |

Validation is performed by `loadRuntimeConfig()` before API/Worker startup.
