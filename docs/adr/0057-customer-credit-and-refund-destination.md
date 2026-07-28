# ADR 0057: Customer credit and refund destination

- Status: Accepted for Sprint 10
- Customer Credit is a non-transferable stored-value account unique by tenant, customer and currency.
- Manual/service-recovery credit uses request plus independent approval; requester self-approval is rejected and reason/note are mandatory.
- Refund restoration is allocated against exact original stored-value settlements. Repeated partial refunds subtract prior completed and pending restoration so restored value cannot exceed original redemption.
- Refund destination is selected and persisted when the refund is planned: `ORIGINAL_TENDER` (default) or `CUSTOMER_CREDIT`. A customer-credit plan creates no external-payment or original-stored-value allocation; this makes the destinations mutually exclusive by construction.
- Customer-credit destination requires an identified customer, matching currency, zero tip refund, independent refund approval and an issued Credit Note. Approval atomically posts one `REFUND_RESTORE` entry and completes the refund; the public issue command is an idempotent confirmation/replay surface.
- Credit Note and refund evidence remain immutable; restoration is always a new ledger entry. One allocation cannot be restored to original tender and also issued as Customer Credit.
- Gift-card funding refunds are separate from service refunds. Automatic refund is allowed only for the full value of an unused card (`redeemed=0`, `reserved=0`, `available=face value`) and returns to the card's captured funding payment. Completion appends `PURCHASE_CANCELLATION`, moves liability to cancelled value and changes the card to `CANCELLED`. Mixed funding/service selections and partially used cards require manual review.
