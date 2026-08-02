# Sprint 16 state transition matrix

Candidates: `DRAFT → PENDING_REVIEW → CLASSIFIED_* / PENDING_CAPITALIZATION → APPROVED_FOR_CAPITALIZATION → CAPITALIZED`.

Assets: `DRAFT → PENDING_CAPITALIZATION → ACTIVE ↔ IN_MAINTENANCE/IDLE/IN_TRANSIT → RETIRED → DISPOSED`.

Runs: `DRAFT → CALCULATING → READY → PENDING_APPROVAL → APPROVED → POSTING → POSTED → REVERSED`.

All other aggregates use explicit command transitions in the assets service; generic status patching is not exposed.
