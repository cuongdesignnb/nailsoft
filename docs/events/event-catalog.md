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
