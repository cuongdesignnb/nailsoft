# Accounting privacy and scope controls

All accounting queries begin with authenticated `tenantId`; branch-scoped roles must provide an authorized branch scope. Book, journal, open-item, bank and statement identifiers are opaque outside the tenant. No bank credentials or raw statement secrets are stored. Audit and outbox payloads use identifiers/fingerprints rather than customer PII.
