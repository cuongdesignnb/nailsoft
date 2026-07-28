# ADR 0049: Moving weighted-average cost

Cost is held per tenant/branch/location/item/lot projection. Receipts recompute `(old value + received quantity × receipt unit cost) / new quantity`. Outbound movements carry the locked average cost; transfers preserve that exact cost. Full depletion resets quantity, value and average cost to zero. Money evidence stays in integer minor units or exact numeric projections and is serialized as strings.
