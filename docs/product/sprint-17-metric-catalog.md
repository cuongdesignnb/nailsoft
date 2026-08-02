# Sprint 17 Metric Catalog (v1)

| Key | Formula / source | Time semantics | Permission | Drill-down |
|---|---|---|---|---|
| `gross_sales` | issued invoice `subtotal_minor`; excludes void, tax, tip and stored-value funding | `invoices.issued_at` in branch timezone | `analytics.sales.read` | `/admin/analytics/sales` |
| `discounts` | issued invoice `discount_minor` | issued date | `analytics.sales.read` | invoice source |
| `net_sales` | gross sales − discounts − authoritative refund | issued/refund posted date | `analytics.sales.read` | invoice/refund source |
| `tax_collected` | issued invoice tax less posted tax reversal | issued/posting date | `analytics.finance.read` | ledger source |
| `tips` | immutable tip entries less reversals | settled date | `analytics.staff.read` | tip source |
| `payments_collected` | successful payment settlement less refund settlement | settlement date | `analytics.sales.read` | payment source |
| `bookings_created` | appointment rows excluding draft/hold/expired | appointment creation/start date | `analytics.booking.read` | booking source |
| `completed_appointments` | terminal completed/checked-out/paid appointments | completion date | `analytics.booking.read` | appointment source |
| `scheduled_utilization` | booked service minutes / eligible working minutes | branch local business date | `analytics.staff.read` | service/shift source |
| `productive_utilization` | completed service minutes / eligible working minutes | service completion date | `analytics.staff.read` | session source |
| `new_customers` | first realized customer visit in period | visit business date | `analytics.customer.read` | customer source |
| `return_30/60/90` | realized customers visiting within 30/60/90 days | branch local date | `analytics.customer.read` | customer source |
| `inventory_value` | inventory balance value at snapshot | inventory snapshot date | `analytics.inventory.read` | inventory source |
| `open_ap` | open vendor-bill/AP balance | posting date | `analytics.procurement.read` | vendor bill source |
| `posted_revenue` | posted accounting journal revenue only | journal posting date | `analytics.finance.read` | journal source |
| `gross_payroll` | finalized payroll earning/deduction evidence | payroll period date | `analytics.workforce.read` | payroll source |
| `asset_nbv` | gross carrying − accumulated depreciation − impairment | asset snapshot date | `analytics.asset.read` | asset register |

Metric version is explicit and must be incremented through an ADR when formulas change. All API responses include currency, timezone, revision and freshness metadata.
