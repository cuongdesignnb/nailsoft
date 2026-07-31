# ADR-0085 Accounting period control

Status: Accepted. Period transitions are explicit, audited and locked in a transaction. A database overlap trigger rejects intersecting periods. CLOSED/REOPEN_PENDING periods reject posting and late operational sources become exceptions.
