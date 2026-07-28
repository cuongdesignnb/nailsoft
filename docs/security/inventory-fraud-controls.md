# Inventory fraud and loss controls

- No API mutates stock balances directly; every physical change has an immutable ledger entry, actor, reason, request ID and aggregate reference.
- Receipt posting and stock counts are versioned and idempotent. Posted receipts are immutable.
- Adjustment and count correction require a review command; reason is mandatory and negative stock is blocked.
- Blind count APIs omit expected quantity while counting, including mobile clients.
- Product refunds do not restore stock. Restock needs an explicit inspection record and branch-authorized actor.
- Cost and supplier contact data are separate permission boundaries. Barcode lookup is exact and designed for gateway rate limiting.
- Exports run asynchronously, escape spreadsheet formula prefixes and use private, short-lived signed URLs when storage is configured.
