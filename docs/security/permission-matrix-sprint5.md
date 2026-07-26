# Sprint 5 operational permission matrix

`yes` is tenant-wide for Owner and branch-scoped for Manager. Technician access is additionally restricted to assigned sessions. Platform Super Admin has no salon-data access without a Support Access Grant.

| Capability                                     | Owner | Manager |     Receptionist     |     Technician     |  Cashier   | Accountant | Marketing | Platform admin |
| ---------------------------------------------- | :---: | :-----: | :------------------: | :----------------: | :--------: | :--------: | :-------: | :------------: |
| Operations board                               |  yes  |   yes   |         yes          |      own only      | ready only |     no     |    no     |     denied     |
| Walk-in read/create/update/call/convert/cancel |  yes  |   yes   |         yes          |         no         |     no     |     no     |    no     |     denied     |
| Walk-in priority override                      |  yes  |   yes   |          no          |         no         |     no     |     no     |    no     |     denied     |
| Arrive/check-in                                |  yes  |   yes   |         yes          |         no         |     no     |     no     |    no     |     denied     |
| Revert check-in                                |  yes  |   yes   |          no          |         no         |     no     |     no     |    no     |     denied     |
| Read service session                           |  all  | branch  |        branch        |        own         |     no     |     no     |    no     |     denied     |
| Start/pause/resume/complete                    |  yes  |   yes   |          no          |        own         |     no     |     no     |    no     |     denied     |
| Cancel active session                          |  yes  |   yes   |          no          |         no         |     no     |     no     |    no     |     denied     |
| Transfer staff                                 |  yes  |   yes   |         yes          | request only in UX |     no     |     no     |    no     |     denied     |
| Add service plan/hold/commit                   |  yes  |   yes   |         yes          | request only in UX |     no     |     no     |    no     |     denied     |
| Notes/media                                    |  yes  |   yes   | branch where granted |        own         |     no     |     no     |    no     |     denied     |
| Checkout-ready summary                         |  yes  |   yes   |         yes          |         no         |    yes     |     no     |    no     |     denied     |

The API guard checks granular permission first. Services then enforce tenant, branch, staff ownership, state and database invariants. A route grant never bypasses these domain checks.
