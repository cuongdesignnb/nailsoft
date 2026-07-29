import { expect, type APIResponse } from "@playwright/test";
import pg from "pg";
import { headers, type Session } from "./api-client";

export const tenant = "10000000-0000-4000-8000-000000000001";
export const branch = "20000000-0000-4000-8000-000000000001";
export const staff3 = "47000000-0000-4000-8000-000000000003";
export const staff5 = "47000000-0000-4000-8000-000000000005";
export const staff6 = "47000000-0000-4000-8000-000000000006";
export const draftRun = "f1200000-0000-4000-8000-000000000091";

export function database() {
  return new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@127.0.0.1:5432/nailsoft",
  });
}

export async function statements(
  db: pg.Pool,
  sql: string,
  values: readonly unknown[] = [],
) {
  for (const statement of sql
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const indexes = [...statement.matchAll(/\$(\d+)/g)].map((match) =>
      Number(match[1]),
    );
    const parameterCount = indexes.length ? Math.max(...indexes) : 0;
    await db.query(statement, [...values].slice(0, parameterCount));
  }
}

export async function expectApi(
  response: APIResponse,
  status = 201,
): Promise<any> {
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(status);
  return body.data;
}

export async function post(
  session: Session,
  path: string,
  data: unknown,
  key: string,
) {
  return expectApi(
    await session.api.post(path, {
      headers: headers(session, key.padEnd(16, "-e2e")),
      data,
    }),
  );
}

export async function get(session: Session, path: string) {
  return expectApi(
    await session.api.get(path, { headers: headers(session) }),
    200,
  );
}

export async function prepareLockedHourlyTimesheet(
  db: pg.Pool,
  options: {
    regularSeconds?: number;
    overtimeSeconds?: number;
    secondBranch?: string;
  } = {},
) {
  const regular = options.regularSeconds ?? 14400;
  const overtime = options.overtimeSeconds ?? 0;
  await db.query(
    "UPDATE attendance_sessions SET state='VOIDED' WHERE tenant_id=$1 AND staff_id=$2 AND state='OPEN'",
    [tenant, staff5],
  );
  await db.query(
    `UPDATE staff_timesheets SET state='LOCKED',regular_seconds=$2,overtime_seconds=$3,payable_seconds=$2::bigint+$3::bigint,
     fingerprint='e2e-locked-source',projection_input_fingerprint='e2e-locked-input',projected_at=now(),
     submitted_fingerprint='e2e-locked-source',approved_fingerprint='e2e-locked-source',locked_fingerprint='e2e-locked-source'
     WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000061'`,
    [tenant, regular, overtime],
  );
  await db.query(
    "DELETE FROM timesheet_day_entries WHERE tenant_id=$1 AND timesheet_id='f1200000-0000-4000-8000-000000000061'",
    [tenant],
  );
  await db.query(
    `INSERT INTO timesheet_day_entries(tenant_id,timesheet_id,local_date,branch_id,regular_seconds,overtime_seconds,payable_seconds,fingerprint)
     VALUES($1,'f1200000-0000-4000-8000-000000000061','2026-08-05',$4,$2,$3,$2::bigint+$3::bigint,'e2e-day')`,
    [tenant, regular, overtime, options.secondBranch ?? branch],
  );
  await db.query(
    "UPDATE staff_pay_profiles SET profile_type='HOURLY',status='ACTIVE',currency='VND' WHERE tenant_id=$1 AND staff_id=$2",
    [tenant, staff5],
  );
}
