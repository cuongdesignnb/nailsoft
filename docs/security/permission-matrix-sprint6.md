# Sprint 6 financial permission matrix

| Capability                       |  Owner  | Manager |     Cashier      | Receptionist |     Accountant     | Technician | Marketing | Platform admin |
| -------------------------------- | :-----: | :-----: | :--------------: | :----------: | :----------------: | :--------: | :-------: | :------------: |
| Read/create/finalize order       | tenant  | branch  |    own branch    |  read only   |     read only      |     no     |    no     |     denied     |
| Discount                         | approve | approve |  apply/request   |      no      |         no         |     no     |    no     |     denied     |
| Tip                              |   yes   |   yes   |   set/allocate   |      no      | read evidence only |     no     |    no     |     denied     |
| Capture cash / external evidence |   yes   |   yes   |       yes        |      no      |         no         |     no     |    no     |     denied     |
| Invoice read/print/deliver       |   yes   |   yes   |       yes        |     read     |     read/print     |     no     |    no     |     denied     |
| Cash session                     |   yes   | branch  |   own session    |      no      |   read evidence    |     no     |    no     |     denied     |
| High variance approval/reopen    |   yes   |   yes   |  no/self-denied  |      no      |         no         |     no     |    no     |     denied     |
| Reconciliation/summary           |   yes   | branch  | operational only |      no      |        read        |     no     |    no     |     denied     |

The guard checks granular grants; services additionally enforce tenant, branch, register, cashier ownership, state and dual-control rules. Platform Super Admin receives no financial permission and requires a separately approved Support Access Grant path.
