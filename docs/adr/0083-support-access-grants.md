# ADR 0083: Support access grants

Status: Accepted. Platform roles do not imply salon-data access. A tenant-approved grant binds user, ticket/reason, permissions, branches, data classes, expiry and session TTL. Tokens persist only as hashes and every use revalidates state/scope. Revoke/expiry blocks immediately. Self-approval is denied; break-glass stays disabled.
