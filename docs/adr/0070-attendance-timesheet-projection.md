# ADR 0070: Attendance and timesheet projection

Status: Accepted for Sprint 12.

Attendance sessions/breaks are projections of clock events. A partial unique index permits one open session per tenant/staff and one open break per session. Timesheets snapshot day entries, branch allocation, raw seconds, rounding delta and a deterministic fingerprint. Adjustment requests require before/after calculations and append-only history. Locked or payroll-source-locked timesheets cannot reopen.

Consequences: cross-midnight work is calculated from UTC facts and reported in branch timezone; replay is safe; correction after payroll finalization requires a supplemental run.
