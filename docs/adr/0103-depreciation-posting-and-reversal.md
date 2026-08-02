# ADR 0103 — Depreciation posting and reversal

Runs follow calculate → submit → independent approve → post. Posting updates the asset once and records a unique posting history/source fingerprint. Reversal is a compensating source event; posted runs and lines remain immutable.
