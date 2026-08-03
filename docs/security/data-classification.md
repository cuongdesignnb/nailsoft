# Data Classification

| Class | Examples | Handling |
|---|---|---|
| Restricted | secrets, payment evidence, MFA material | secret manager/encryption, never logs |
| Confidential | tenant financial, staff and customer records | tenant/branch authorization, least privilege |
| Internal | operational metrics, audit metadata | access controlled, no PII labels |
| Public | product documentation, health status | no credentials or internal topology |
