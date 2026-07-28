# Business event catalog

## Standard envelope

Every domain and outbox event uses this immutable structure:

```json
{
  "eventId": "uuid",
  "eventType": "appointment.confirmed",
  "eventVersion": 1,
  "occurredAt": "2026-07-10T15:00:00.000Z",
  "tenantId": "uuid",
  "branchId": null,
  "aggregateType": "appointment",
  "aggregateId": "uuid",
  "aggregateVersion": 12,
  "actor": { "type": "USER", "id": "uuid" },
  "source": "api",
  "correlationId": "uuid",
  "causationId": null,
  "traceId": null,
  "data": {},
  "metadata": { "schemaVersion": 1 }
}
```

## Contract rules

- `eventId` is globally unique and is the consumer idempotency key.
- `eventVersion` versions the event payload; incompatible changes require an increment and consumer migration.
- `aggregateVersion` is monotonic per aggregate and lets clients/consumers detect ordering gaps.
- Published event content is immutable. Corrections are new events.
- Tenant and authorized branch context are mandatory; `branchId` may be null only for tenant-wide events.
- Passwords, tokens, raw card data and unnecessary sensitive customer data are forbidden.
- Correlation follows the request/workflow; causation points to the direct triggering command or event.

## Initial catalog

The owning sprint finalizes payload schemas and acceptance tests for: appointment created/confirmed/rescheduled/cancelled, customer checked in, service started/completed, invoice created, payment completed/failed, refund completed, tip recorded, commission calculated, voucher redeemed, package used, stock below threshold, shift started/ended, and notification requested/delivered/failed.

## Sprint 2 events

`service_category.created`, `service_category.updated`, `service_category.archived`, `service.created`, `service.updated`, `service.activated`, `service.deactivated`, `service.archived`, `service_price.created`, `service_price.updated`, `service_price.cancelled`, `skill.created`, `skill.updated`, `skill.archived`, `resource.created`, `resource.updated`, `resource.status_changed`, `staff.created`, `staff.updated`, `staff.status_changed`, `staff.branch_assigned`, `staff.branch_assignment_ended`, `staff.skill_changed`, `shift.created`, `shift.updated`, `shift.published`, `shift.cancelled`, `leave.requested`, `leave.approved`, `leave.rejected`, and `leave.cancelled` use the standard envelope and are consumed idempotently by `eventId`.
Hardening failures are synchronous domain conflicts and do not emit events. Successful mutations continue to emit the existing audited events (`staff.branch_assignment_updated`, `shift.published`, `service.addons_changed`, `leave.*`) through the transactional outbox.

## Sprint 3 events

`availability.block_created`, `availability.block_updated`, and `availability.block_cancelled` are written transactionally with the block audit record. `availability.version_bumped`, `availability.cache_invalidated`, `calendar.projection_updated`, and `calendar.projection_removed` describe downstream processing and realtime fan-out. WebSocket clients receive `availability.invalidated` and `calendar.event_created|updated|removed`, then refetch PostgreSQL-backed APIs; realtime payloads are never final state.

### Durable realtime routing

The Worker routes organization (`branch.updated`, `business_hours.updated`), service and price, service skill/resource requirements, staff/assignment/skill, shift, leave, resource and availability-block events. Tenant-wide events resolve every active branch; branch-wide events resolve active staff rooms; staff-specific events resolve the authoritative branch assignment. Each delivery reads the latest `availability_versions` row and carries the outbox `eventId`.

Security events `session.revoked`, `session.logout_all`, `membership.suspended`, `membership.revoked`, `user.suspended`, `user.disabled`, `authorization.changed`, `branch_scope.removed` and `role.changed` map to minimal Redis disconnect control messages. Unknown events are acknowledged and increment `outbox_event_ignored_total`. A branch or staff target that does not belong to the event tenant is failed without emit.

## Sprint 4 events

`slot_hold.created`, `slot_hold.released`, `slot_hold.expired`, `slot_hold.consumed`, `appointment.created`, `appointment.pending_confirmation`, `appointment.deposit_required`, `appointment.deposit_waived`, `appointment.confirmed`, `appointment.rescheduled`, `appointment.cancelled` and `appointment.expired` use the standard transactional outbox envelope.

Booking events contain identifiers, status, aggregate version, schedule boundaries and `refetch: true`; they never contain raw capability tokens, OTP values, customer contact details, notes or the full booking aggregate. The Worker routes tenant/branch/assigned-staff rooms and emits availability invalidation plus calendar create/update/remove hints. Notification jobs are created idempotently by appointment/event and are delivered by provider adapters.

Public contact and booking-access OTP delivery uses the durable `booking_otp_delivery_jobs` lifecycle (`PENDING -> PROCESSING -> DELIVERED | FAILED`) rather than a domain event carrying the code. The challenge and encrypted delivery job are committed in one PostgreSQL transaction. Worker claims use `FOR UPDATE SKIP LOCKED`, recover expired leases and retry with a bounded schedule. Provider calls receive the decrypted code only in memory; OTP values, capabilities and provider credentials are forbidden from outbox payloads and logs.

## Sprint 5 events

Walk-in events: `walkin.created`, `walkin.status_changed`, `walkin.estimate_updated`, `walkin.converted`.

Appointment operations: `appointment.arrived`, `appointment.checked_in`, `appointment.check_in_reverted`, `appointment.operational_status_changed`, `appointment.item_added`, `appointment.item_cancelled`, `appointment.checkout_ready`.

Execution events: `service_session.created`, `service_session.started`, `service_session.paused`, `service_session.resumed`, `service_session.completed`, `service_session.cancelled`, `service_session.staff_transferred`, `service_session.note_added`, `service_session.note_updated`, `service_session.media_added`, `service_session.media_upload_reported`, `service_session.media_deleted`.

`service_session.media_upload_reported` explicitly means that an authorized client reported completion. It does not assert object integrity and never promotes metadata to `READY`; that state requires a trusted provider callback or Worker verification of object existence, checksum, MIME type and size.

All are committed with the authoritative transaction. Payloads contain identifiers, status/version and `refetch: true`, never customer contact, notes or media URLs. The Worker resolves tenant, branch, assigned-staff and authorized appointment rooms, reads `branch_operational_versions`, then emits `operations.invalidated` plus `walkin.updated`, `appointment.updated` or `service_session.updated`. Realtime is an invalidation signal only.

# Sprint 6 financial events

The following events use the existing safe outbox envelope and contain refetch identifiers plus minor-unit/currency summaries only:

- `pos.order_created`, `pos.register_assigned`, `pos.order_recalculated`, `pos.order_finalized`, `pos.order_partially_paid`, `pos.order_paid`, `pos.order_voided`
- `pos.discount_applied`, `pos.discount_approved`, `pos.tip_set`
- `payment.captured`, `payment.failed`
- `invoice.issued`, `invoice.delivery_requested`
- `cash_session.opened`, `cash_session.closing_started`, `cash_session.declared`, `cash_session.reopened`, `cash_session.closed`, `cash_movement.created`

Worker routing targets tenant, branch, register, cash-session, order and appointment rooms. Payloads are invalidation signals, not financial truth, and exclude customer/payment secrets.

# Sprint 7 correction and commission events

Refund lifecycle: `refund.created`, `refund.submitted`, `refund.approved`, `refund.rejected`, `refund.cancelled`, `refund.processing`, `refund.completed`, `refund.failed`, `refund.unknown`, `refund.cash_executed`, `refund.external_recorded`.

Correction documents: `credit_note.issued`, `credit_note.delivery_requested`.

Commission: `commission.rule_created`, `commission.rule_superseded`, `commission.rule_deactivated`, `commission.entry_generated`, `commission.refund_reversal_generated`, `commission.adjustment_requested`, `commission.adjustment_approved`, `commission.adjustment_rejected`, `commission.period_created`, `commission.period_review_started`, `commission.period_reopened`, `commission.period_locked`.

Reporting: `financial.export_requested`.

Events are committed with audit and authoritative PostgreSQL state. Refund payloads contain only invoice/refund IDs, reference, status, amount/currency, branch/register attribution and `refetch: true`; provider secrets, full references, customer data and payment credentials are forbidden. Worker routing emits `refund.updated`, `credit_note.updated`, `commission.updated` or `financial.updated` to authorized tenant/branch/staff rooms. Staff events contain an authorized staff ID and never salon-wide revenue.

# Sprint 8 customer benefit events

Voucher: `voucher.campaign_created`, `voucher.code_issued`, `voucher.reserved`, `voucher.redeemed`, `voucher.released`, `voucher.reversed`, `voucher.updated`.

Loyalty: `loyalty.program_created`, `loyalty.points_pending`, `loyalty.points_available`, `loyalty.points_reserved`, `loyalty.points_redeemed`, `loyalty.points_released`, `loyalty.points_expired`, `loyalty.adjustment_requested`, `loyalty.adjustment_approved`, `loyalty.updated`.

Membership and package: `membership.tier_created`, `membership.assigned`, `membership.upgraded`, `membership.revoked`, `membership.updated`, `package.product_created`, `package.issued`, `package.reserved`, `package.committed`, `package.released`, `package.reversed`, `package.updated`, `benefits.refund_reversed`.

Closure semantics: `membership.updated` also signals automatic downgrade or no-qualifying-tier removal after rolling paid-minus-refunded recomputation. `benefits.refund_reversed` identifies the refund and affected application/allocation only; exact monetary, points, unit and fractional-use evidence remains in append-only PostgreSQL allocation rows. Benefit Worker jobs use bounded retries and `DEAD_LETTER`; job errors never become business events.

Payloads contain tenant/branch and aggregate IDs, version/status and `refetch: true`; voucher codes, customer contacts, ledger notes and qualification detail are forbidden. Worker fans out minimal `voucher.updated`, `loyalty.updated`, `membership.updated`, `package.updated` and `benefits.wallet_invalidated` signals to authorized tenant/branch rooms. Clients refetch PostgreSQL-backed APIs.
