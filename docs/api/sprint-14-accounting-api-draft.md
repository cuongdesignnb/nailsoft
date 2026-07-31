# Sprint 14 accounting API

The implemented command boundary is under `/v1/accounting`. Commands use `Idempotency-Key`, authenticated actor context and optimistic `version` where applicable. Journal lifecycle commands are explicit: `submit`, `approve`, `reject`, `post`, `request-reversal` and `approve-reversal`. Read reports require `bookId`; bigint monetary values are serialized as strings.

Closure work adds database guards and migration `0029`; source posting, bank matching and functional UI remain evidence-gated until their dedicated tests pass.
