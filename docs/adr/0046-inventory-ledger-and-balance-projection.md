# ADR 0046: Inventory ledger and balance projection

Status: Accepted for Sprint 9.

PostgreSQL `inventory_stock_ledger_entries` is append-only evidence. `inventory_stock_balances` is a transactionally maintained projection keyed by tenant, branch, location, item and optional lot. Every movement locks that key, validates `on_hand >= reserved >= 0`, appends one ledger row and updates the projection in the same transaction. Corrections create reversal or adjustment entries; ledger rows are never edited or deleted.
