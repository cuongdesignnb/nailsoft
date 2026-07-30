# ADR 0081: Platform payment exactly-once

Status: Accepted. Provider key `platform-payment:<tenant>:<invoice>:<intent>` is stable across attempts. UNKNOWN blocks retry until reconciliation. Provider events/evidence hashes are unique. Manual payment/refund requires independent approval and evidence. Fake provider is dev/test-only; production without an adapter fails closed.
