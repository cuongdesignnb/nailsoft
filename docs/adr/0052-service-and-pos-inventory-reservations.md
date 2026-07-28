# ADR 0052: Service and POS inventory reservations

Service recipes and retail order lines reserve available stock before commitment. Service completion commits its material reservation; cancellation releases it. A paid POS order commits retail reservations inside the payment transaction. Refund completion never restocks: a separate tenant/branch-authorized inspection decision may post `RETURN_RESTOCK`, quarantine, damage or discard.
