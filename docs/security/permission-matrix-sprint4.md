# Sprint 4 booking permission matrix

| Permission                         |       Owner       |      Manager      |   Receptionist    |     Technician      | Cashier | Accountant | Marketing | Platform admin |
| ---------------------------------- | :---------------: | :---------------: | :---------------: | :-----------------: | :-----: | :--------: | :-------: | :------------: |
| `appointment.read` / `read_branch` |      tenant       |      branch       |      branch       |          —          | branch  |   branch   |     —     |     denied     |
| `appointment.read_own`             | via broader scope | via broader scope | via broader scope | assigned items only |    —    |     —      |     —     |     denied     |
| `appointment.create`               |        yes        |      branch       |      branch       |          —          |    —    |     —      |     —     |     denied     |
| `appointment.confirm`              |        yes        |      branch       |      branch       |          —          |    —    |     —      |     —     |     denied     |
| `appointment.reschedule`           |        yes        |      branch       |      branch       |          —          |    —    |     —      |     —     |     denied     |
| `appointment.cancel`               |        yes        |      branch       |      branch       |          —          |    —    |     —      |     —     |     denied     |
| `appointment.assign_staff`         |        yes        |      branch       |      branch       |          —          |    —    |     —      |     —     |     denied     |
| `appointment.override_policy`      |        yes        |      branch       |         —         |          —          |    —    |     —      |     —     |     denied     |
| `appointment.waive_deposit`        |        yes        |      branch       |         —         |          —          |    —    |     —      |     —     |     denied     |
| `slot_hold.read/create/release`    |        yes        |      branch       |      branch       |          —          |    —    |     —      |     —     |     denied     |
| `customer.booking_lookup/create`   |        yes        |      branch       |      branch       |          —          |    —    |     —      |     —     |     denied     |

Public customer access is not a role grant. It requires a short-lived purpose-bound capability and is revalidated against PostgreSQL on every management request. Platform Super Admin receives no salon booking permission without a future support-access grant.
