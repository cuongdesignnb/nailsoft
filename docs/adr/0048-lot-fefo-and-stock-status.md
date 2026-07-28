# ADR 0048: Lot, FEFO and stock status

Lot-tracked reservations select the earliest non-expired `AVAILABLE` lot. `QUARANTINE`, `DAMAGED`, `EXPIRED` and `DEPLETED` lots are unavailable. Expiry jobs only raise alerts or mark eligible lots; they never fabricate physical movement.
