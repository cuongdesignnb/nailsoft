# Marketing Attribution

## Product contract

NailSoft Marketing Attribution is an explicit, server-authoritative last-touch model. A Campaign recipient can receive a short-lived attribution context from the API. A Booking is attributed only when the Booking request carries that context and the server validates the tenant, Campaign recipient, Customer, Campaign branch, context generation, lifecycle, and expiry.

```text
MODEL=EXPLICIT_LAST_TOUCH
DEFAULT_ATTRIBUTION_WINDOW_DAYS=30
```

The context is single-use. Its opaque UUID is returned only by the controlled issue flow and is hashed before persistence. The browser may carry it to the public booking flow, but it is not authoritative and is never stored in localStorage, analytics, audit payloads, or outbox payloads. A missing, invalid, expired, reused, cross-Customer, cross-Branch, or cross-Tenant context leaves the Booking valid but unattributed.

## Authoritative records

- `marketing_attribution_contexts` — issued context lifecycle, Campaign recipient/generation and expiry.
- `marketing_booking_attributions` — one immutable Campaign attribution per Booking.
- `marketing_attributed_financial_evidence` — one immutable paid Order/issued Invoice evidence record.
- `marketing_attribution_revenue_adjustments` — one immutable refund adjustment per Refund, with Credit Note evidence.

The model uses composite tenant foreign keys and database consistency triggers. Financial evidence requires a PAID POS Order, an ISSUED Invoice, matching currency/order/invoice/Appointment/Customer, and a CAPTURED payment when a payment reference is supplied. Refund adjustments require a COMPLETED Refund, an ISSUED Credit Note, matching currency/invoice, and cannot exceed the remaining attributed gross evidence.

## Revenue and refund semantics

Gross attributed revenue is calculated from the existing invoice `net_minor` authority joined to source POS lines. Gift Card funding lines are excluded. Revenue is grouped by the persisted currency; there is no client-side FX conversion.

Refunds are projected from completed `refund_items` for invoice lines. A Credit Note is evidence for the same refund, not another deduction. Replayed paid-order/refund events return the existing evidence/adjustment and do not duplicate totals. Historical Campaign membership alone never backfills attribution.

## API surface

- `POST /v1/marketing-campaigns/:campaignId/audience/:recipientId/attribution-context` — controlled context issue, guarded by `marketing.attribution.issue` and idempotency.
- `GET /v1/marketing-campaigns/:campaignId/attribution` — Campaign attribution summary/evidence, guarded by `marketing.attribution.read`.
- `GET /v1/appointments/:appointmentId/marketing-attribution` — Booking attribution read, guarded by `marketing.attribution.read`.
- Existing Marketing overview and Campaign overview responses expose attribution only when the caller has `marketing.attribution.read`.

Existing Campaign, Booking, POS payment, Invoice, Refund, Credit Note, Communication, and Worker contracts remain the owners of their state transitions. Attribution is a projection/evidence layer; it does not replace payment, invoice, refund, consent, or Campaign lifecycle logic.

## Capability boundary

Booking attribution and refund-aware revenue attribution are supported. Open tracking and click tracking remain unsupported because the current provider/event adapter does not persist those events. No open, click, conversion, booking-by-timing, or revenue-by-timing metric is generated.

## Security and privacy

Every read/write is tenant scoped. Campaign and Appointment branch scope is enforced in service code and database triggers. The read model returns entity IDs and safe evidence fields; it does not return Customer contact data, contact hashes, provider credentials, payment secrets, or raw context hashes. Context issue and projection audit/outbox entries contain IDs, model, currency, and safe evidence metadata only.

## Non-goals

- Open/click tracking.
- Multi-touch or probabilistic attribution.
- Marketing send-engine replacement.
- Client-side authoritative attribution state.
- Historical guessing or retroactive attribution without explicit evidence.
- Cross-currency revenue totals.
