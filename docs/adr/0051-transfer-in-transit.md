# ADR 0051: Transfer and in-transit ownership

Shipping atomically decreases the source at its current cost and records shipped evidence. Receipt increases the destination at the same cost. Concurrent ship/receive commands are serialized by aggregate version and stock-key locks. Variance is append-only and needs an explicit reason.
