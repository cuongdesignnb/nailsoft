# ADR 0104 — Maintenance work-order lifecycle

Preventive and corrective work use explicit work-order commands. Starting a work order moves the asset to `IN_MAINTENANCE`; independent verification restores it to `ACTIVE`. Completion evidence, cost and downtime are append-only history inputs.
