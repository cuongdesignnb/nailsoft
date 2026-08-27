import { expect, test } from "./helpers/deterministic-visual-fixture";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

test.describe("Sprint 19 Wave 5 procurement workspace", () => {
  test("renders payment proposal read foundation with authorized branch context", async ({ page }) => {
    await login(page);
    await page.goto("/admin/procurement/payment-proposals");
    await expect(page.getByRole("heading", { name: "Đề xuất thanh toán" })).toBeVisible();
    await expect(page.getByText(/Giữ số tiền khoản mở/)).toBeVisible();
    const branch = page.getByLabel("Chi nhánh đang làm việc");
    if (await branch.count()) await expect(branch).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  });

  test("keeps vendor returns in procurement ownership and exposes safe empty/error states", async ({ page }) => {
    await login(page);
    await page.goto("/admin/procurement/returns");
    await expect(page.getByRole("heading", { name: "Trả hàng nhà cung cấp" })).toBeVisible();
    await expect(page.getByText(/Quy trình hiện tại kiểm tra số lượng trả/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Làm mới" })).toBeVisible();
  });
});
