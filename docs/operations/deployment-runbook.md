# Deployment Runbook

Verify clean tree, exact release manifest/SBOM, successful CI, migration status and backup evidence. Deploy API and Worker with rolling replacement, then verify startup/readiness/version endpoints, authenticated smoke and metrics. Keep the release commit immutable and record the exact SHA. This runbook does not authorize production go-live by itself.
