# Sprint 12 State-transition Matrix

| Aggregate      | From               | Command                  | To                     | Guard                                                  |
| -------------- | ------------------ | ------------------------ | ---------------------- | ------------------------------------------------------ |
| Attendance     | none               | clock-in                 | OPEN                   | trusted branch/device policy; one active staff session |
| Attendance     | OPEN               | clock-out                | CLOSED/REVIEW_REQUIRED | open break creates exception; server time              |
| Break          | none               | start                    | OPEN                   | attendance OPEN; one open break                        |
| Break          | OPEN               | end                      | CLOSED                 | server time; no synthetic deduction                    |
| Timesheet      | DRAFT              | submit                   | SUBMITTED              | fingerprint current; no open session/blocker           |
| Timesheet      | SUBMITTED          | approve/reject           | APPROVED/REJECTED      | dual control                                           |
| Timesheet      | APPROVED           | lock/reopen              | LOCKED/REOPENED        | no payroll source lock for reopen                      |
| Payroll run    | DRAFT/FAILED       | calculate                | CALCULATED             | approved policy, rates, locked sources                 |
| Payroll run    | CALCULATED         | submit                   | PENDING_APPROVAL       | no blocking exception                                  |
| Payroll run    | PENDING_APPROVAL   | approve                  | APPROVED               | preparer differs                                       |
| Payroll run    | APPROVED           | finalize                 | FINALIZED              | finalizer independent; fingerprint stable              |
| Payroll run    | FINALIZED          | request/approve void     | VOID_PENDING/VOIDED    | reason/evidence; no direct paid-payout void            |
| Payout batch   | DRAFT              | submit                   | PENDING_APPROVAL       | finalized unpaid statements only                       |
| Payout batch   | PENDING_APPROVAL   | approve                  | APPROVED               | requester differs                                      |
| Payout item    | PROCESSING         | provider/manual evidence | PAID                   | amount/currency/evidence match                         |
| Reconciliation | UNMATCHED/VARIANCE | resolve                  | RESOLVED               | reason/evidence; no balancing write                    |
