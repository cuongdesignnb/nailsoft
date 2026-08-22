import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { headers, login } from "./helpers/api-client";

const draftOrder = "a4000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";

async function loginUi(page: import("@playwright/test").Page, email: string) {
  await page.goto("http://localhost:3000/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await page.locator("form button").click();
  await expect(page.getByRole("status")).toBeVisible();
}

test("Cashier sees the real POS order detail and immutable financial evidence", async ({
  page,
}) => {
  await loginUi(page, "cashier@example.test");
  await page.goto(`http://localhost:3000/admin/pos/orders/${draftOrder}`);
  await expect(
    page.getByRole("heading", { name: "Chi tiết đơn hàng" }),
  ).toBeVisible();
  await expect(page.getByText("#POS-SEED-DRAFT", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dịch vụ & sản phẩm" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Tóm tắt đơn hàng" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lịch sử hoạt động" }),
  ).toBeVisible();
  await expect(page.getByText("Đơn hàng không có ưu đãi.")).toBeVisible();
  await expect(page.getByText("Chưa có tiền tip.")).toBeVisible();
});

test("Cash register views expose real seeded data and permission state", async ({
  page,
}) => {
  await loginUi(page, "cashier@example.test");
  await page.goto("http://localhost:3000/admin/pos/registers");
  await expect(
    page.getByRole("heading", { name: "Quản lý quầy thu ngân" }),
  ).toBeVisible();
  await expect(page.getByText("Q1-POS-01", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Q1-DRAWER-01", { exact: true }).first()).toBeVisible();

  await page.goto("http://localhost:3000/admin/pos/cash-sessions");
  await expect(
    page.getByRole("heading", { name: "Lịch sử phiên thu ngân" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await loginUi(page, "staff5@example.test");
  await page.goto("http://localhost:3000/admin/pos");
  await expect(
    page.getByRole("heading", { name: /Permission denied|Không có quyền|Không thể tải/ }).first(),
  ).toBeVisible();
});

test("Owner Mobile contract is backed by a real read-only financial API", async () => {
  const owner = await authenticated("owner");
  const technician = await login("staff5@example.test");
  try {
    const summary = await owner.api.get(
      `/v1/financial/summary?branchId=${branch}`,
      { headers: headers(owner) },
    );
    expect(summary.status()).toBe(200);
    const body = await summary.json();
    expect(body.data.totals).toEqual(
      expect.objectContaining({
        todaySalesMinor: expect.any(Number),
        paidOrders: expect.any(Number),
        tipsMinor: expect.any(Number),
        openCashSessions: expect.any(Number),
      }),
    );
    const denied = await technician.api.get(
      `/v1/financial/summary?branchId=${branch}`,
      { headers: headers(technician) },
    );
    expect(denied.status()).toBe(403);
  } finally {
    await close(owner);
    await close(technician);
  }
});
