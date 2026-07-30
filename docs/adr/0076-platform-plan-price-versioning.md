# ADR 0076: Platform plan and price versioning

Status: Accepted for Sprint 13.

Catalog data lives in platform billing, never salon POS. A published plan points to an immutable ACTIVE version. Active prices use integer minor units, explicit currency, type and interval. Periods snapshot the exact version/price. `LEGACY_INTERNAL` is migration-only, zero-priced and collection-disabled.
