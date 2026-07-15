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
