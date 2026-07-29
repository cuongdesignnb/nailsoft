# Payroll Privacy Controls

- Full bank/routing details are never stored in business tables; payment methods retain a token/reference and masked hint.
- Audit/outbox redact account, device secret/PIN, raw GPS and full pay statement fields.
- Statements use tenant and own-staff authorization; list screens omit statement JSON.
- Exports use private tenant-prefixed storage keys, checksum, short-lived signed-link foundation and spreadsheet-formula escaping at rendering.
- Clock location is minimized evidence; no biometric collection, continuous GPS or IP geolocation.
- Provider secrets come only from environment variables and production payout fails closed when absent.
- Payroll writes are online-only. Local mobile storage may cache display data, never confirm a write before server response.
