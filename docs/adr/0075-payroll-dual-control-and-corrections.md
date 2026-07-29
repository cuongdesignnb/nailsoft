# ADR 0075: Payroll dual control and corrections

Status: Accepted for Sprint 12.

Policy flags require requester/preparer to differ from approver, and payroll finalizer to differ from preparer/approver. Payout request and approval are separated. Approval snapshots are append-only. Finalized payroll void requires a second workflow; already-paid payout must be reversed or corrected, never directly erased.

Consequences: small salons need at least two authorized identities for protected actions. Emergency bypass is deliberately absent; any change requires a BA/PO change request and auditable policy design.
