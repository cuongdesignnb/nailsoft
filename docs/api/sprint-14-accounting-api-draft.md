# Sprint 14 accounting API

The implemented command boundary is under `/v1/accounting`. Commands use `Idempotency-Key`, authenticated actor context and optimistic `version` where applicable. Journal lifecycle commands are explicit: `submit`, `approve`, `reject`, `post`, `request-reversal` and `approve-reversal`. Read reports require `bookId`; bigint monetary values are serialized as strings.

Closure work adds migration `0030`, source posting and bank reconciliation commands. Source posting accepts only allowlisted source types, stable source fingerprints/generation keys and balanced line evidence; missing mappings fail closed to `REVIEW_REQUIRED`. Bank imports are CSV-only in the baseline and deduplicate by file checksum/line fingerprint. Reconciliation close requires zero unexplained difference; void requires independent approval. Statement snapshots transition `GENERATED -> APPROVED -> FINAL` and final records are immutable.
