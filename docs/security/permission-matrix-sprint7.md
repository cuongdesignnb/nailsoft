# Sprint 7 permission matrix

| Capability                     |  Owner |             Manager |                Cashier | Reception |            Accountant |    Technician | Marketing | Platform Admin |
| ------------------------------ | -----: | ------------------: | ---------------------: | --------: | --------------------: | ------------: | --------: | -------------: |
| Request/read refund            |      ✓ |              branch |                 branch |    branch |                branch |             — |         — |         denied |
| Approve/reject refund          |      ✓ |        policy limit |                      — |         — |                policy |             — |         — |         denied |
| Execute cash refund            |      ✓ |              branch | own authorized session |         — |                     — |             — |         — |         denied |
| Execute external refund        |      ✓ |              branch |     permitted evidence |         — |                     — |             — |         — |         denied |
| Credit note read/print/deliver |      ✓ |              branch |             read/print |         — |                     ✓ |             — |         — |         denied |
| Rules                          | manage | read; policy manage |                      — |         — |                manage |             — |         — |         denied |
| Commission entries             | tenant |              branch |                      — |         — |                branch |      own only |         — |         denied |
| Period review/lock             |      ✓ |                read |                      — |         — | review; lock by grant | own statement |         — |         denied |
| Financial export               |      ✓ |            optional |                      — |         — |                     ✓ |             — |         — |         denied |

Dual control always overrides a nominal role grant: a requester cannot approve the same refund or adjustment. Platform Super Admin requires a separate Support Access Grant and receives no tenant financial permission by default.
