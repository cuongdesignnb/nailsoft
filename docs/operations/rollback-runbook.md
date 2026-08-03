# Rollback Runbook

Stop promotion, retain the failing release artifacts, and decide application rollback versus forward fix with the incident commander. Never roll back applied migrations by editing history. If data writes are incompatible, restore to an isolated target, reconcile, and promote only after integrity checks. Record exact old/new SHAs and verification results.
