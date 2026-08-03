# PII Handling Standard

Collect only fields required for salon operations, enforce tenant/branch/staff scope at every access path, and redact secrets/credentials from logs and error responses. Metrics, realtime invalidation signals and release artifacts must not include phone, email, payment token or customer names. Media uses private tenant-scoped storage and short-lived signed access when enabled.
