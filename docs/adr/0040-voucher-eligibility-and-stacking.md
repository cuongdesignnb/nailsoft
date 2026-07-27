# ADR 0040: Voucher eligibility and stacking

Status: Accepted for Sprint 8.

Voucher input is NFKC-normalized, whitespace/hyphens removed and uppercased, then stored only as tenant-bound HMAC-SHA256 plus last four characters. Production requires a dedicated secret. Eligibility evaluates campaign lifecycle, local validity, branch/service/customer/tier scopes, minimum spend and limits. One voucher per order is the baseline; discount uses integer minor units, is capped by maximum discount and never exceeds the eligible base. Reservation counters are changed by locked conditional updates.
