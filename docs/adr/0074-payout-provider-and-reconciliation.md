# ADR 0074: Payout provider and reconciliation

Status: Accepted for Sprint 12.

The provider boundary supports create, submit, status, cancel, reverse and signed-event handling. Provider calls occur outside long database transactions; items are leased with `SKIP LOCKED`. Production provider mode fails closed unless URL and secret exist. `PAID` requires matching confirmed amount and either provider reference or approved redacted manual evidence. Provider events are deduplicated.

Consequences: local QA can use manual/fake evidence but cannot invent production success. Reconciliation records variance and never creates hidden balancing entries.
