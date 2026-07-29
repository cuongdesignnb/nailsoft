# Communication Privacy Controls

- Customer outbound channel is email-only in Sprint 11; no SMS implementation exists.
- Marketing defaults to not granted. Consent evidence stores definition version/hash, source, timestamp and redacted context.
- Addresses are rendered only inside the delivery worker. API lists use hashes/redacted references.
- Logs exclude email bodies, full addresses, public tokens and provider credentials.
- Unsubscribe tokens are signed, expiring and stored as hashes; withdrawal creates immediate suppression.
- Review tokens are transaction-bound and revalidated at submission.
- Campaign preview and reports return counts or redacted records; Branch Managers cannot build tenant-wide audiences.
- Recovery contact summaries redact email-like values and remain branch/staff scoped.
- Export jobs are asynchronous metadata foundations; no public object is created.
