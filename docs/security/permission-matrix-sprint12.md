# Sprint 12 Permission Matrix

| Capability                         |             Owner |       Manager |    Reception | Technician |                  Accountant | Marketing/Cashier | Platform |
| ---------------------------------- | ----------------: | ------------: | -----------: | ---------: | --------------------------: | ----------------: | -------: |
| Own clock/timesheet/statement      |               Yes |      if staff |           No |   Yes, own |                    if staff |                No |       No |
| Branch attendance/device/exception |               Yes |           Yes | read/support |         No |                          No |                No |       No |
| Timesheet review/approve/lock      |               Yes |        branch |           No | submit own |                          No |                No |       No |
| Policy/compliance                  |              full | branch review |           No |         No | read only by explicit grant |                No |       No |
| Pay profile/rate                   |              full | explicit only |           No |         No |                        read |                No |       No |
| Payroll prepare/calculate/submit   |               Yes | explicit only |           No |         No |                         Yes |                No |       No |
| Payroll approve/finalize/void      | Yes, dual control | explicit only |           No |         No |                  No default |                No |       No |
| Payout prepare/process/reconcile   |               Yes | explicit only |           No |         No |                         Yes |                No |       No |
| Payout approve/reverse             | Yes, dual control | explicit only |           No |         No |                  No default |                No |       No |

Platform Super Admin receives no Sprint 12 salon-data permission. Support Access Grant remains mandatory. Route guards are complemented by tenant, branch and own-staff checks inside the service.
