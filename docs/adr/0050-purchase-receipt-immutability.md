# ADR 0050: Purchase and receipt immutability

Purchase orders follow command-specific transitions. A posted goods receipt is immutable and is the only supplier workflow that increases physical stock. Partial receipts update received quantities and derive PO status. Number counters are locked per tenant, branch and local year.
