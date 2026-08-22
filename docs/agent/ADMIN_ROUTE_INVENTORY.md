# NailSoft Admin route inventory

Generated from the current route registry, path predicates, and catch-all dispatch branches. Parameter names are normalized to the route matcher form used by the admin app. Query strings and command endpoints are excluded.

- Route patterns recorded: **231**
- Scope: /admin/** and /platform/** UI route patterns discovered in the current app
- Unmapped route patterns at this checkpoint: **0**
- Validation status: **MAPPED** (runtime/browser acceptance remains in the main progress ledger)

| # | Route pattern | Wave | Owner | Dispatch |
|---:|---|:---:|---|---|
| 001 | /admin/accounting | H | Wave 6 accounting/banking | mapped |
| 002 | /admin/accounting/books | H | Wave 6 accounting/banking | mapped |
| 003 | /admin/accounting/journals | H | Wave 6 accounting/banking | mapped |
| 004 | /admin/accounting/open-items | H | Wave 6 accounting/banking | mapped |
| 005 | /admin/accounting/periods | H | Wave 6 accounting/banking | mapped |
| 006 | /admin/accounting/posting-candidates | H | Wave 6 accounting/banking | mapped |
| 007 | /admin/accounting/reconciliation | H | Wave 6 accounting/banking | mapped |
| 008 | /admin/accounting/reconciliation/exceptions | H | Wave 6 accounting/banking | mapped |
| 009 | /admin/accounting/reconciliation/statement-lines | H | Wave 6 accounting/banking | mapped |
| 010 | /admin/accounting/reports | H | Wave 6 accounting/banking | mapped |
| 011 | /admin/accounting/statement-snapshots | H | Wave 6 accounting/banking | mapped |
| 012 | /admin/analytics | K | Wave 6 analytics | mapped |
| 013 | /admin/analytics/bookings | K | Wave 6 analytics | mapped |
| 014 | /admin/analytics/data-quality | K | Wave 6 analytics | mapped |
| 015 | /admin/analytics/sales | K | Wave 6 analytics | mapped |
| 016 | /admin/analytics/staff | K | Wave 6 analytics | mapped |
| 017 | /admin/appointments | A | Wave 1 scheduling/operations | mapped |
| 018 | /admin/appointments/:id | A | Wave 1 scheduling/operations | mapped |
| 019 | /admin/appointments/:id/add-service | A | Wave 1 scheduling/operations | mapped |
| 020 | /admin/appointments/:id/cancel | A | Wave 1 scheduling/operations | mapped |
| 021 | /admin/appointments/:id/check-in | A | Wave 1 scheduling/operations | mapped |
| 022 | /admin/appointments/:id/checkout-summary | A | Wave 1 scheduling/operations | mapped |
| 023 | /admin/appointments/:id/execution | A | Wave 1 scheduling/operations | mapped |
| 024 | /admin/appointments/:id/history | A | Wave 1 scheduling/operations | mapped |
| 025 | /admin/appointments/:id/overview | A | Wave 1 scheduling/operations | mapped |
| 026 | /admin/appointments/:id/reschedule | A | Wave 1 scheduling/operations | mapped |
| 027 | /admin/appointments/new | A | Wave 1 scheduling/operations | mapped |
| 028 | /admin/assets/candidates | G | Wave 5 fixed assets | mapped |
| 029 | /admin/assets/capitalization | G | Wave 5 fixed assets | mapped |
| 030 | /admin/assets/counts | G | Wave 5 fixed assets | mapped |
| 031 | /admin/assets/depreciation | G | Wave 5 fixed assets | mapped |
| 032 | /admin/assets/disposals | G | Wave 5 fixed assets | mapped |
| 033 | /admin/assets/impairments | G | Wave 5 fixed assets | mapped |
| 034 | /admin/assets/inspections | G | Wave 5 fixed assets | mapped |
| 035 | /admin/assets/maintenance | G | Wave 5 fixed assets | mapped |
| 036 | /admin/assets/reports | G | Wave 5 fixed assets | mapped |
| 037 | /admin/assets/transfers | G | Wave 5 fixed assets | mapped |
| 038 | /admin/availability | A | Wave 1 scheduling/operations | mapped |
| 039 | /admin/availability/search | A | Wave 1 scheduling/operations | mapped |
| 040 | /admin/benefits | C | Wave 3 customer/benefits/engagement | mapped |
| 041 | /admin/benefits/customers | C | Wave 3 customer/benefits/engagement | mapped |
| 042 | /admin/benefits/customers/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 043 | /admin/benefits/liability | C | Wave 3 customer/benefits/engagement | mapped |
| 044 | /admin/benefits/reports | C | Wave 3 customer/benefits/engagement | mapped |
| 045 | /admin/billing | I | Wave 6 tenant billing/support | mapped |
| 046 | /admin/billing/history | I | Wave 6 tenant billing/support | mapped |
| 047 | /admin/billing/invoices | I | Wave 6 tenant billing/support | mapped |
| 048 | /admin/billing/invoices/:id | I | Wave 6 tenant billing/support | mapped |
| 049 | /admin/billing/invoices/detail | I | Wave 6 tenant billing/support | mapped |
| 050 | /admin/billing/payment-methods | I | Wave 6 tenant billing/support | mapped |
| 051 | /admin/billing/plans | I | Wave 6 tenant billing/support | mapped |
| 052 | /admin/billing/subscription | I | Wave 6 tenant billing/support | mapped |
| 053 | /admin/billing/usage | I | Wave 6 tenant billing/support | mapped |
| 054 | /admin/calendar | A | Wave 1 scheduling/operations | mapped |
| 055 | /admin/calendar/day | A | Wave 1 scheduling/operations | mapped |
| 056 | /admin/calendar/week | A | Wave 1 scheduling/operations | mapped |
| 057 | /admin/catalog/categories | L | Legacy/settings/catalog | mapped |
| 058 | /admin/catalog/resource-types | L | Legacy/settings/catalog | mapped |
| 059 | /admin/catalog/resources | L | Legacy/settings/catalog | mapped |
| 060 | /admin/catalog/services | L | Legacy/settings/catalog | mapped |
| 061 | /admin/catalog/services/:id | L | Legacy/settings/catalog | mapped |
| 062 | /admin/catalog/skills | L | Legacy/settings/catalog | mapped |
| 063 | /admin/commission | B | Wave 2 POS/finance | mapped |
| 064 | /admin/commission/adjustments | B | Wave 2 POS/finance | mapped |
| 065 | /admin/commission/entries | B | Wave 2 POS/finance | mapped |
| 066 | /admin/commission/periods | B | Wave 2 POS/finance | mapped |
| 067 | /admin/commission/periods/:id | B | Wave 2 POS/finance | mapped |
| 068 | /admin/commission/rules | B | Wave 2 POS/finance | mapped |
| 069 | /admin/commission/rules/:id | B | Wave 2 POS/finance | mapped |
| 070 | /admin/commission/rules/new | B | Wave 2 POS/finance | mapped |
| 071 | /admin/communications/messages | C | Wave 3 customer/benefits/engagement | mapped |
| 072 | /admin/communications/rules | C | Wave 3 customer/benefits/engagement | mapped |
| 073 | /admin/communications/suppressions | C | Wave 3 customer/benefits/engagement | mapped |
| 074 | /admin/communications/templates | C | Wave 3 customer/benefits/engagement | mapped |
| 075 | /admin/credit-notes | B | Wave 2 POS/finance | mapped |
| 076 | /admin/credit-notes/:id | B | Wave 2 POS/finance | mapped |
| 077 | /admin/customer-care | C | Wave 3 customer/benefits/engagement | mapped |
| 078 | /admin/customer-credit | C | Wave 3 customer/benefits/engagement | mapped |
| 079 | /admin/customers | C | Wave 3 customer/benefits/engagement | mapped |
| 080 | /admin/customers/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 081 | /admin/customers/:id/engagement | C | Wave 3 customer/benefits/engagement | mapped |
| 082 | /admin/customers/new | C | Wave 3 customer/benefits/engagement | mapped |
| 083 | /admin/dashboard | L | Legacy/settings/catalog | mapped |
| 084 | /admin/financial/commission | B | Wave 2 POS/finance | mapped |
| 085 | /admin/financial/exports | B | Wave 2 POS/finance | mapped |
| 086 | /admin/financial/invoices | B | Wave 2 POS/finance | mapped |
| 087 | /admin/financial/net-sales | B | Wave 2 POS/finance | mapped |
| 088 | /admin/financial/payments | B | Wave 2 POS/finance | mapped |
| 089 | /admin/financial/reconciliation | B | Wave 2 POS/finance | mapped |
| 090 | /admin/financial/refunds | B | Wave 2 POS/finance | mapped |
| 091 | /admin/gift-cards | C | Wave 3 customer/benefits/engagement | mapped |
| 092 | /admin/gift-cards/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 093 | /admin/gift-cards/issuance | C | Wave 3 customer/benefits/engagement | mapped |
| 094 | /admin/gift-cards/products | C | Wave 3 customer/benefits/engagement | mapped |
| 095 | /admin/inventory/adjustments | E | Wave 5 inventory | mapped |
| 096 | /admin/inventory/alerts | E | Wave 5 inventory | mapped |
| 097 | /admin/inventory/counts | E | Wave 5 inventory | mapped |
| 098 | /admin/inventory/items | E | Wave 5 inventory | mapped |
| 099 | /admin/inventory/locations | E | Wave 5 inventory | mapped |
| 100 | /admin/inventory/lots | E | Wave 5 inventory | mapped |
| 101 | /admin/inventory/purchase-orders | E | Wave 5 inventory | mapped |
| 102 | /admin/inventory/receipts | E | Wave 5 inventory | mapped |
| 103 | /admin/inventory/reports | E | Wave 5 inventory | mapped |
| 104 | /admin/inventory/service-recipes | E | Wave 5 inventory | mapped |
| 105 | /admin/inventory/stock | E | Wave 5 inventory | mapped |
| 106 | /admin/inventory/suppliers | E | Wave 5 inventory | mapped |
| 107 | /admin/inventory/transfers | E | Wave 5 inventory | mapped |
| 108 | /admin/inventory/valuation | E | Wave 5 inventory | mapped |
| 109 | /admin/loyalty/adjustments | C | Wave 3 customer/benefits/engagement | mapped |
| 110 | /admin/loyalty/customers | C | Wave 3 customer/benefits/engagement | mapped |
| 111 | /admin/loyalty/customers/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 112 | /admin/loyalty/programs | C | Wave 3 customer/benefits/engagement | mapped |
| 113 | /admin/marketing/campaigns | C | Wave 3 customer/benefits/engagement | mapped |
| 114 | /admin/marketing/campaigns/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 115 | /admin/marketing/segments | C | Wave 3 customer/benefits/engagement | mapped |
| 116 | /admin/membership/customers | C | Wave 3 customer/benefits/engagement | mapped |
| 117 | /admin/membership/customers/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 118 | /admin/membership/tiers | C | Wave 3 customer/benefits/engagement | mapped |
| 119 | /admin/operations/board | A | Wave 1 scheduling/operations | mapped |
| 120 | /admin/operations/walk-ins | A | Wave 1 scheduling/operations | mapped |
| 121 | /admin/operations/walk-ins/:id | A | Wave 1 scheduling/operations | mapped |
| 122 | /admin/operations/walk-ins/new | A | Wave 1 scheduling/operations | mapped |
| 123 | /admin/organization/branches | L | Legacy/settings/catalog | mapped |
| 124 | /admin/organization/general | L | Legacy/settings/catalog | mapped |
| 125 | /admin/packages/catalog | C | Wave 3 customer/benefits/engagement | mapped |
| 126 | /admin/packages/catalog/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 127 | /admin/packages/entitlements | C | Wave 3 customer/benefits/engagement | mapped |
| 128 | /admin/packages/entitlements/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 129 | /admin/payout-reconciliation | B | Wave 2 POS/finance | mapped |
| 130 | /admin/payouts | B | Wave 2 POS/finance | mapped |
| 131 | /admin/payouts/:id | B | Wave 2 POS/finance | mapped |
| 132 | /admin/pos | B | Wave 2 POS/finance | mapped |
| 133 | /admin/pos/cash-sessions | B | Wave 2 POS/finance | mapped |
| 134 | /admin/pos/cash-sessions/:id | B | Wave 2 POS/finance | mapped |
| 135 | /admin/pos/cash-sessions/open | B | Wave 2 POS/finance | mapped |
| 136 | /admin/pos/checkout | B | Wave 2 POS/finance | mapped |
| 137 | /admin/pos/new | B | Wave 2 POS/finance | mapped |
| 138 | /admin/pos/orders | B | Wave 2 POS/finance | mapped |
| 139 | /admin/pos/orders/:id | B | Wave 2 POS/finance | mapped |
| 140 | /admin/procurement/ap | F | Wave 5 procurement | mapped |
| 141 | /admin/procurement/credit-notes | F | Wave 5 procurement | mapped |
| 142 | /admin/procurement/payment-proposals | F | Wave 5 procurement | mapped |
| 143 | /admin/procurement/purchase-orders | F | Wave 5 procurement | mapped |
| 144 | /admin/procurement/purchase-requests | F | Wave 5 procurement | mapped |
| 145 | /admin/procurement/receipts | F | Wave 5 procurement | mapped |
| 146 | /admin/procurement/returns | F | Wave 5 procurement | mapped |
| 147 | /admin/procurement/vendor-bills | F | Wave 5 procurement | mapped |
| 148 | /admin/procurement/vendor-payments | F | Wave 5 procurement | mapped |
| 149 | /admin/procurement/vendors | F | Wave 5 procurement | mapped |
| 150 | /admin/profile | L | Legacy/settings/catalog | mapped |
| 151 | /admin/refunds | B | Wave 2 POS/finance | mapped |
| 152 | /admin/refunds/:id | B | Wave 2 POS/finance | mapped |
| 153 | /admin/refunds/new | B | Wave 2 POS/finance | mapped |
| 154 | /admin/review-requests | C | Wave 3 customer/benefits/engagement | mapped |
| 155 | /admin/review-requests/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 156 | /admin/reviews | C | Wave 3 customer/benefits/engagement | mapped |
| 157 | /admin/reviews/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 158 | /admin/scheduling/blocks | A | Wave 1 scheduling/operations | mapped |
| 159 | /admin/scheduling/leave-requests | L | Legacy/settings/catalog | mapped |
| 160 | /admin/scheduling/leave-requests/:id | L | Legacy/settings/catalog | mapped |
| 161 | /admin/scheduling/shifts | L | Legacy/settings/catalog | mapped |
| 162 | /admin/scheduling/shifts/:id | L | Legacy/settings/catalog | mapped |
| 163 | /admin/security/sessions | L | Legacy/settings/catalog | mapped |
| 164 | /admin/service-recovery | C | Wave 3 customer/benefits/engagement | mapped |
| 165 | /admin/service-recovery/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 166 | /admin/service-sessions/:id | A | Wave 1 scheduling/operations | mapped |
| 167 | /admin/staff/:id | D | Wave 4 workforce/payroll | mapped |
| 168 | /admin/staff/:id/pay-profile | D | Wave 4 workforce/payroll | mapped |
| 169 | /admin/staff/list | D | Wave 4 workforce/payroll | mapped |
| 170 | /admin/staff/new | D | Wave 4 workforce/payroll | mapped |
| 171 | /admin/stored-value/adjustments | C | Wave 3 customer/benefits/engagement | mapped |
| 172 | /admin/stored-value/exceptions | C | Wave 3 customer/benefits/engagement | mapped |
| 173 | /admin/stored-value/legal-policies | C | Wave 3 customer/benefits/engagement | mapped |
| 174 | /admin/stored-value/liability | C | Wave 3 customer/benefits/engagement | mapped |
| 175 | /admin/stored-value/reconciliation | C | Wave 3 customer/benefits/engagement | mapped |
| 176 | /admin/stored-value | C | Wave 3 customer/benefits/engagement | mapped |
| 177 | /admin/support-access | I | Wave 6 tenant billing/support | mapped |
| 178 | /admin/team/users | L | Legacy/settings/catalog | mapped |
| 179 | /admin/time-clock | D | Wave 4 workforce/payroll | mapped |
| 180 | /admin/time-clock/devices | D | Wave 4 workforce/payroll | mapped |
| 181 | /admin/time-clock/exceptions | D | Wave 4 workforce/payroll | mapped |
| 182 | /admin/time-clock/sessions | D | Wave 4 workforce/payroll | mapped |
| 183 | /admin/timesheet-periods | D | Wave 4 workforce/payroll | mapped |
| 184 | /admin/timesheets | D | Wave 4 workforce/payroll | mapped |
| 185 | /admin/timesheets/:id | D | Wave 4 workforce/payroll | mapped |
| 186 | /admin/vouchers | C | Wave 3 customer/benefits/engagement | mapped |
| 187 | /admin/vouchers/campaigns | C | Wave 3 customer/benefits/engagement | mapped |
| 188 | /admin/vouchers/campaigns/:id | C | Wave 3 customer/benefits/engagement | mapped |
| 189 | /admin/vouchers/codes | C | Wave 3 customer/benefits/engagement | mapped |
| 190 | /admin/workforce | D | Wave 4 workforce/payroll | mapped |
| 191 | /admin/workforce/compliance | D | Wave 4 workforce/payroll | mapped |
| 192 | /admin/workforce/policies | D | Wave 4 workforce/payroll | mapped |
| 193 | /admin/workforce/reports | D | Wave 4 workforce/payroll | mapped |
| 194 | /platform/break-glass | J | Wave 6 platform | mapped |
| 195 | /platform/discounts | J | Wave 6 platform | mapped |
| 196 | /platform/dunning | J | Wave 6 platform | mapped |
| 197 | /platform/invoices | J | Wave 6 platform | mapped |
| 198 | /platform/payments | J | Wave 6 platform | mapped |
| 199 | /platform/plans | J | Wave 6 platform | mapped |
| 200 | /platform/prices | J | Wave 6 platform | mapped |
| 201 | /platform/reconciliation | J | Wave 6 platform | mapped |
| 202 | /platform/reports | J | Wave 6 platform | mapped |
| 203 | /platform/support-access | J | Wave 6 platform | mapped |
| 204 | /platform/tenants | J | Wave 6 platform | mapped |
| 205 | /platform/tenants/:id | J | Wave 6 platform | mapped |
| 206 | /platform/tenants/detail | J | Wave 6 platform | mapped |
| 207 | /platform/tenants/entitlements | J | Wave 6 platform | mapped |
| 208 | /platform/tenants/invoices | J | Wave 6 platform | mapped |
| 209 | /platform/tenants/subscription | J | Wave 6 platform | mapped |
| 210 | /admin/assets | G | Wave 5 fixed assets | mapped |
| 211 | /admin/financial | B | Wave 2 POS/finance | mapped |
| 212 | /admin/inventory | E | Wave 5 inventory | mapped |
| 213 | /admin/procurement | F | Wave 5 procurement | mapped |
| 214 | /admin/communications | C | Wave 3 customer/benefits/engagement | mapped |
| 215 | /admin/marketing | C | Wave 3 customer/benefits/engagement | mapped |
| 216 | /admin/pos/registers | B | Wave 2 POS/finance | mapped |
| 217 | /admin/pos/checkout/:id | B | Wave 2 POS/finance | mapped |
| 218 | /admin/pos/orders/:id/payment | B | Wave 2 POS/finance | mapped |
| 219 | /admin/pos/orders/:id/receipt | B | Wave 2 POS/finance | mapped |
| 220 | /admin/pos/cash-sessions/:id/close | B | Wave 2 POS/finance | mapped |
| 221 | /admin/pos/orders/:id/stored-value | C | Wave 3 customer/benefits/engagement | mapped |
| 222 | /admin/pos/orders/:id/gift-card | C | Wave 3 customer/benefits/engagement | mapped |
| 223 | /admin/pos/orders/:id/benefits | C | Wave 3 customer/benefits/engagement | mapped |
| 224 | /admin/operations | A | Wave 1 scheduling/operations | mapped |
| 225 | /admin/payroll/calendars | D | Wave 4 workforce/payroll | mapped |
| 226 | /admin/payroll/exceptions | D | Wave 4 workforce/payroll | mapped |
| 227 | /admin/payroll/periods | D | Wave 4 workforce/payroll | mapped |
| 228 | /admin/payroll/reports | D | Wave 4 workforce/payroll | mapped |
| 229 | /admin/payroll/runs | D | Wave 4 workforce/payroll | mapped |
| 230 | /admin/payroll/runs/:id | D | Wave 4 workforce/payroll | mapped |
| 231 | /admin/payroll/statements | D | Wave 4 workforce/payroll | mapped |

## Notes

- /admin/financial/invoices, /admin/financial/payments, /admin/financial/reconciliation, /admin/refunds, /admin/credit-notes, commission, and net-sales have explicit precedence before the Wave 2 catch-all.
- /admin/marketing/campaigns/:id and /admin/customers/:id/engagement are resolved before generic customer/marketing fallbacks.
- /admin/financial is the Wave 2 financial landing route; /admin/financial/exports remains owned by the existing reporting surface because the backend exposes export job detail rather than a separate directory contract.
- Platform routes are included because they are reachable from the same authenticated admin application shell but are authorization-isolated from salon data.
- Landing routes added at the end are intentional source-defined entry points; payroll detail and operations root are included because the active dispatchers resolve them. The inventory is one row per normalized view pattern, not a claim that every trailing-slash alias is a separate screen.
