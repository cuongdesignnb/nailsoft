# ADR 0080: Platform invoices and credit ledger

Status: Accepted. Platform invoices use dedicated tables and numbering. Finalization locks snapshots, verifies line sum, assigns number/fingerprint and makes economics immutable. Credit notes and account credit are append-only; balance is `sum(entries)`. Salon POS, gift card, customer credit and loyalty are not valid sources.
