# ADR-0088 Manual journal dual control

Status: Accepted. The requester submits a journal and an independent authenticated approver approves it. The server never trusts an approver ID from the request body; self approval is rejected and approval history is append-only.
