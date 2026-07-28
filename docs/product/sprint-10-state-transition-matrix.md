# Sprint 10 State Transition Matrix

| Aggregate          | From               | Command                | To                    | Hard guards                                          |
| ------------------ | ------------------ | ---------------------- | --------------------- | ---------------------------------------------------- |
| Gift card          | none               | issue POS line         | PENDING_ACTIVATION    | active product, amount/currency, draft order         |
| Gift card          | PENDING_ACTIVATION | captured funding       | ACTIVE                | order paid, unique funding/generation                |
| Gift card          | PENDING_ACTIVATION | void/remove            | CANCELLED             | no activation                                        |
| Gift card          | ACTIVE             | suspend                | SUSPENDED             | permission, version, reason                          |
| Gift card          | SUSPENDED          | reactivate             | ACTIVE                | permission, version                                  |
| Gift card          | ACTIVE/SUSPENDED   | replace                | REPLACED + new ACTIVE | no reservation, atomic liability transfer            |
| Gift card          | ACTIVE             | reload                 | ACTIVE                | reloadable, captured unique funding, maximum balance |
| Gift card          | ACTIVE             | redeem to zero         | DEPLETED              | paid settlement                                      |
| Gift card          | ACTIVE             | refund unused purchase | CANCELLED             | full face value, no redeem/reserve, original funding |
| Reservation        | none               | reserve                | ACTIVE                | online, eligible due, available balance              |
| Reservation        | ACTIVE             | paid checkout          | COMMITTED             | exact invoice allocation                             |
| Reservation        | ACTIVE             | release/TTL            | RELEASED/EXPIRED      | one terminal state                                   |
| Credit adjustment  | none               | request                | PENDING               | customer/currency/reason/note                        |
| Credit adjustment  | PENDING            | independent approve    | APPROVED              | no self-approval, append ledger                      |
| Credit adjustment  | PENDING            | reject/cancel          | REJECTED/CANCELLED    | version/reason                                       |
| Refund destination | APPROVED           | issue customer credit  | COMPLETED             | no other allocation, customer, credit note, no tip   |

Derived liability is never a client-controlled status. Expiration/forfeit has no automatic transition unless an approved policy version explicitly authorizes it.
