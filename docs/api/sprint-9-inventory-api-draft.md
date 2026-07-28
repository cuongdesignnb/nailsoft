# Sprint 9 Inventory API

All paths are under `/v1`, require tenant-authenticated access and granular `inventory.*` permissions. Mutation commands require an `Idempotency-Key` of at least 16 characters and optimistic `version` where an aggregate already exists.

Catalog: `inventory/uoms`, `inventory/uom-conversions`, `inventory/items/:itemId/uom-conversions`, `inventory/categories`, `inventory/items`, `inventory/barcodes/:barcode`, `inventory/locations`, `inventory/suppliers`, `inventory/service-recipes`.

Operations: `inventory/stock`, `inventory/ledger`, `inventory/adjustments`, `inventory/counts`, `inventory/alerts`, `inventory/reports/valuation`, `inventory/exports`.

Purchasing: `inventory/purchase-orders` plus `submit`, `approve`, `cancel`, `close`; `inventory/goods-receipts` plus `post`, `cancel`; `inventory/transfers` plus `request`, `approve`, `ship`, `receive`, `cancel`.

Execution/POS: `service-sessions/:id/materials` plus `reserve`, `actual-usage`, `commit`, `release`, `override-shortage`; `staff/me/materials`; `pos-orders/:id/product-lines` plus `update`, `remove`; refund inspection and explicit return-decision posting.

Actual usage is recorded independently from posting. Only `commit` (or the atomic service-completion hook) writes a physical `SERVICE_CONSUMPTION` ledger entry. A shortage override remains visible as `MANUAL_REVIEW`, requires granular permission plus a reason, and is audit/outbox recorded.

Stock, quantity, cost and money values are decimal strings. Database uniqueness or check failures are mapped to inventory domain conflicts rather than accepted as partial success.
