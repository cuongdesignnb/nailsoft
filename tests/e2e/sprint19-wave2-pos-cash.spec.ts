import { expect, test } from "./helpers/deterministic-visual-fixture";
import AxeBuilder from "@axe-core/playwright";

const seededOrder = "a4000000-0000-4000-8000-000000000003";

async function loginUi(page: import("@playwright/test").Page, email = "cashier@example.test") {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function assertAccessible(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page }).include("main").analyze();
  expect(result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe("Sprint 19 Wave 2 POS, payment and cash surfaces", () => {
  test("POS home exposes branch/register context and responsive actions", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto("/admin/pos");
    await expect(page.getByRole("heading", { name: "Trung tâm POS", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tạo đơn mới" })).toBeVisible();
    await expect(page.getByLabel("Chi nhánh làm việc")).toBeVisible();
    await assertAccessible(page);
    await page.screenshot({ path: test.info().outputPath("pos-sale-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("pos-sale-mobile.png"), fullPage: true });
  });

  test("real order detail keeps server totals and legacy command affordances", async ({ page }) => {
    await loginUi(page);
    await page.goto(`/admin/pos/orders/${seededOrder}`);
    await expect(page.getByRole("heading", { name: "Chi tiết đơn hàng", exact: true })).toBeVisible();
    await expect(page.getByText("#POS-SEED-PARTIAL", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dịch vụ & sản phẩm", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Giao dịch thanh toán", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Thu số còn lại" }).first()).toBeVisible();
    await assertAccessible(page);
  });

  test("payment surface keeps server due and split-tender safeguards visible", async ({ page }) => {
    await loginUi(page);
    await page.goto(`/admin/pos/orders/a4000000-0000-4000-8000-000000000003/payment`);
    await expect(page.getByRole("heading", { name: "Thanh toán", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Số tiền khách thanh toán", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Tiền mặt/ })).toBeVisible();
    await expect(page.getByText("Cho phép thu từng phần", { exact: true })).toBeVisible();
    await expect(page.getByText(/80\.000/).first()).toBeVisible();
    await assertAccessible(page);
    await page.screenshot({ path: test.info().outputPath("split-tender-checkout.png"), fullPage: true });
  });

  test("paid orders expose receipt only through issued invoice data", async ({ page }) => {
    await loginUi(page);
    await page.setViewportSize({ width: 1672, height: 941 });
    await page.goto("/admin/pos/orders/a4000000-0000-4000-8000-000000000004/receipt");
    await expect(page.getByRole("heading", { name: "Thanh toán thành công", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Biên nhận", exact: true })).toBeVisible();
    await expect(page.getByText("Q1-2026-000001", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Mã xác minh:", { exact: false })).toBeVisible();
    await assertAccessible(page);
    await page.screenshot({ path: test.info().outputPath("receipt-success.png"), fullPage: true });
  });

  test("register close and refund review routes are real API-backed surfaces", async ({ page }) => {
    await loginUi(page, "staff2@example.test");
    await page.goto("/admin/pos/registers");
    await expect(page.getByRole("heading", { name: "Quản lý quầy thu ngân", exact: true })).toBeVisible();
    await page.goto("/admin/refunds/new");
    await expect(page.getByRole("heading", { name: "Tạo yêu cầu hoàn tiền", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Xem trước hoàn tiền" })).toBeVisible();
    await assertAccessible(page);
    await page.screenshot({ path: test.info().outputPath("refund-review.png"), fullPage: true });
  });
});
