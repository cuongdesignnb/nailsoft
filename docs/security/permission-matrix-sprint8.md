# Sprint 8 permission matrix

| Role                 | Voucher              | Loyalty                    | Membership      | Package                   | Reports/POS                     |
| -------------------- | -------------------- | -------------------------- | --------------- | ------------------------- | ------------------------------- |
| Salon Owner          | Manage/redeem        | Manage/read/adjust/approve | Manage/evaluate | Manage/issue/redeem       | Full tenant scope               |
| Branch Manager       | Manage in scope      | Manage/read/dual control   | Manage in scope | Manage in scope           | Branch scope                    |
| Receptionist         | Metadata read        | Account read               | Assignment read | Read/reserve              | Eligibility only                |
| Cashier              | Read/redeem          | Read/redeem                | Read/apply      | Read/redeem               | Apply/release at POS            |
| Technician           | None                 | None                       | None            | Assigned appointment read | No POS/customer wallet          |
| Accountant           | Read                 | Read ledger                | Read            | Read                      | Liability/reports               |
| Marketing            | Campaign/code manage | Program manage             | Tier manage     | Catalog read              | No redemption/liability         |
| Customer             | Own only             | Own account/ledger         | Own assignment  | Own packages              | Capability-bound booking        |
| Platform Super Admin | Denied               | Denied                     | Denied          | Denied                    | Requires explicit support grant |

All queries additionally enforce tenant ID, branch/staff/customer scope and return 403/404 according to the existing anti-enumeration policy.
