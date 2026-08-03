# Secret Inventory

| Secret class | Owner | Storage | Rotation trigger | Logging rule |
|---|---|---|---|---|
| JWT signing secret | Platform security | deployment secret manager | compromise or scheduled rotation | never log |
| Identity hash secret | Identity owner | deployment secret manager | compromise or migration plan | never log |
| MFA encryption key | Identity owner | deployment secret manager/KMS | compromise with key versioning | never log |
| Database credentials | Platform operations | managed secret manager | provider policy | redact URLs in diagnostics |
| Redis credentials | Platform operations | managed secret manager | provider policy | never log |
| Object storage access/secret key | Storage owner | cloud secret manager | compromise | never log |
| OTP/payment provider token | Integration owner | deployment secret manager | provider rotation | redact token/signature |

The repository scan rejects private-key and common token signatures. `.env` files are ignored by Git and must be provisioned separately.
