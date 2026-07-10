# Sprint 1 status — Identity, Tenant, Branch & Authorization

Status: implementation complete locally; awaiting the GitHub Actions run on the final pushed commit.

Completed scope includes global email/password and phone/OTP authentication, workspace selection, durable invitations, password recovery, TOTP/recovery-code MFA with enrollment grace, strict refresh rotation and client single-flight, tenant/branch permission enforcement, session administration, Admin Web operational routes, Owner/Staff Mobile authentication foundations, redacted security logging, OpenAPI/ERD updates, and load-smoke tooling.

Migration `0004_identity_recovery_mfa` is immutable once pushed. Its up/down cycle was exercised from a fresh database and re-migrated successfully. Migrations `0001–0003` were not modified.

The following Sprint 2 domains remain intentionally out of scope: Booking, Calendar, Service Catalog, POS, Payment, Commission, Inventory and advanced Marketing/AI.

Known technical debt: the development fake OTP provider deliberately does not deliver through an external SMS provider; production wiring must supply the `OtpProvider` interface. The Admin Web route shell is a foundation for the detailed CRUD interaction polish; backend authorization remains the source of truth.
