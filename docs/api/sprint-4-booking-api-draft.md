# Sprint 4 booking API draft

All internal commands require bearer authentication, tenant context, `X-Request-Id` and `Idempotency-Key`. Public write commands require an idempotency key and rate-limit subject. Responses use the existing success/error envelope.

## Internal

- `POST /v1/booking-plans`
- `POST /v1/slot-holds`
- `GET /v1/slot-holds/{holdId}`
- `POST /v1/slot-holds/{holdId}/release`
- `GET /v1/customers`
- `POST /v1/customers`
- `GET|POST /v1/appointments`
- `GET /v1/appointments/{appointmentId}`
- `GET /v1/appointments/{appointmentId}/history`
- `GET /v1/appointments/{appointmentId}/schedule-revisions`
- `POST /v1/appointments/{appointmentId}/confirm`
- `POST /v1/appointments/{appointmentId}/reschedule-hold`
- `POST /v1/appointments/{appointmentId}/reschedule`
- `POST /v1/appointments/{appointmentId}/cancel`
- `POST /v1/appointments/{appointmentId}/waive-deposit`

No generic status or timestamp `PATCH` is provided.

## Public

- `GET /v1/public/salons/{salonSlug}`
- `GET /v1/public/salons/{salonSlug}/branches`
- `GET /v1/public/salons/{salonSlug}/services`
- `GET /v1/public/salons/{salonSlug}/staff`
- `GET /v1/public/salons/{salonSlug}/availability`
- `POST /v1/public/salons/{salonSlug}/slot-holds`
- `POST /v1/public/salons/{salonSlug}/contact-verification/request`
- `POST /v1/public/salons/{salonSlug}/contact-verification/verify`
- `POST /v1/public/salons/{salonSlug}/bookings`
- `POST /v1/public/salons/{salonSlug}/bookings/access/request`
- `POST /v1/public/salons/{salonSlug}/bookings/access/verify`
- `GET /v1/public/salons/{salonSlug}/bookings/{bookingReference}`
- `POST /v1/public/salons/{salonSlug}/bookings/{bookingReference}/reschedule-holds`
- `POST /v1/public/salons/{salonSlug}/bookings/{bookingReference}/reschedule`
- `POST /v1/public/salons/{salonSlug}/bookings/{bookingReference}/cancel`

Management endpoints require a `booking-management` capability token. The salon slug, token tenant, appointment tenant, reference and contact-verification version are revalidated before idempotency replay. References are case-insensitive and never sufficient authority. Public create accepts only the strict public customer contract, verified contact capability and the current accepted policy version; `customerId` and internal fields are rejected.

## Conflict mapping

- stale availability/fingerprint: `409 AVAILABILITY_CHANGED`
- staff exclusion: `409 STAFF_RESERVED`
- capacity/exclusive conflict: `409 RESOURCE_RESERVED` or `RESOURCE_CAPACITY_INSUFFICIENT`
- consumed/expired hold: `409 SLOT_HOLD_ALREADY_CONSUMED` or `SLOT_HOLD_EXPIRED`
- stale appointment version: `409 BOOKING_VERSION_CONFLICT`
- same idempotency key/different request: `409 IDEMPOTENCY_KEY_REUSED`
