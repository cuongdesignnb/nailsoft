import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { close, headers, login } from "./helpers/api-client";

const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";

test("Operational Board and Staff Today honor the branch local date", async () => {
  const db = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@127.0.0.1:5432/nailsoft",
  });
  const owner = await login("owner@example.test");
  const technician = await login("staff7@example.test");
  try {
    await db.query(
      "UPDATE branches SET timezone='Asia/Ho_Chi_Minh' WHERE tenant_id=$1 AND id=$2",
      [tenantId, branchId],
    );
    await db.query(
      "UPDATE appointments SET branch_id=$3,status='CONFIRMED',confirmed_at=coalesce(confirmed_at,now()),start_at='2026-07-26T18:00:00Z',end_at='2026-07-26T18:30:00Z' WHERE tenant_id=$1 AND id=$2",
      [tenantId, "70000000-0000-4000-8000-000000000001", branchId],
    );
    const board = await owner.api.get(
      `/v1/operations/board?branchId=${branchId}&date=2026-07-27`,
      { headers: headers(owner) },
    );
    expect(board.status(), await board.text()).toBe(200);
    const data = (await board.json()).data;
    expect(data.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(Object.values(data.columns).flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "70000000-0000-4000-8000-000000000001",
        }),
      ]),
    );

    const today = await technician.api.get("/v1/staff/me/today", {
      headers: headers(technician),
    });
    expect(today.status(), await today.text()).toBe(200);
    expect((await today.json()).data.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ branchId, timezone: "Asia/Ho_Chi_Minh" }),
      ]),
    );
  } finally {
    await db.end();
    await close(owner);
    await close(technician);
  }
});
