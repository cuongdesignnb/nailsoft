# ADR 0082: Dunning and tenant access modes

Status: Accepted. Dunning stages are generation-key deduplicated and email-only. READ_ONLY/BILLING_ONLY/SUSPENDED block salon writes while preserving Owner billing, payment, export, security and support. Reconciled full payment restores FULL. No lifecycle transition deletes salon data.
