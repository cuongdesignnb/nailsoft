# Secret Rotation Runbook

1. Create a new version in the secret manager; do not edit source files.
2. Validate the new value against the production schema in an isolated deployment.
3. Roll API and Worker instances gradually, checking `/v1/health/startup` and `/v1/health/ready`.
4. Revoke the previous credential only after all instances report the new `COMMIT_SHA`/version.
5. Run authenticated smoke checks and record the rotation timestamp, approver and evidence artifact.
6. If validation fails, stop rollout and use the rollback runbook; never log the secret.
