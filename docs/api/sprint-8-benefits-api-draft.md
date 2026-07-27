# Sprint 8 Benefits API

All internal commands require bearer authentication, tenant context, granular permission and `Idempotency-Key`. Sensitive conflicts return stable domain codes, including `VOUCHER_RESERVATION_CONFLICT`, `LOYALTY_INSUFFICIENT_POINTS`, `LOYALTY_SELF_APPROVAL_DENIED`, `MEMBERSHIP_ASSIGNMENT_CONFLICT`, `PACKAGE_RESERVATION_CONFLICT`, `PACKAGE_INSUFFICIENT_BALANCE`, `BENEFIT_VERSION_CONFLICT` and `BENEFIT_REVERSAL_CONFLICT`.

| Aggregate | Read endpoints | Commands |
| --- | --- | --- |
| Voucher | `/voucher-campaigns`, `/voucher-codes`, `/customers/{id}/vouchers` | create/activate/pause/end campaign; issue/batch/assign/cancel code; POS reserve/release |
| Loyalty | `/loyalty-programs`, `/customers/{id}/loyalty[/ledger]`, `/loyalty-adjustments` | create/supersede/deactivate; reserve/release; adjustment request/approve/reject/cancel |
| Membership | `/membership-tiers`, `/customers/{id}/membership` | create/supersede/deactivate; assign/revoke/evaluate; POS apply |
| Package | `/service-packages`, `/customers/{id}/packages`, `/customer-packages/{id}[/ledger]` | issue/adjust/reserve/release; appointment and POS reservation |
| Benefits | `/pos-orders/{id}/benefits[/eligibility]`, `/appointments/{id}/benefits`, reports | apply/release and export |

Customer self-service uses `/customer/me/benefits|loyalty|membership|packages`. Booking management uses capability-bound `/public/salons/{slug}/customer-packages` and `/package-reservations`; it never accepts a customer identifier. Responses expose voucher last-four only.
