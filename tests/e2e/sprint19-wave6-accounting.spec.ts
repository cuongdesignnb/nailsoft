import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/deterministic-visual-fixture";
import type { Page } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

async function loginUi(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function expectWorkspace(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
  await expect(page.getByText("Command JSON")).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

async function ensureAccountingBook() {
  const accountant = await login("accountant@example.test");
  try {
    const response = await accountant.api.post("/v1/accounting/books", {
      headers: headers(accountant, `wave6-book-${Date.now()}`),
      data: { code: `W6E2E${Date.now().toString().slice(-6)}`, name: "Wave 6 E2E Accounting", functionalCurrency: "VND", timezone: "Asia/Ho_Chi_Minh" },
    });
    expect(response.ok(), `accounting book setup failed: ${JSON.stringify(await response.json())}`).toBeTruthy();
  } finally {
    await close(accountant);
  }
}

test.describe.serial("Sprint 19 Wave 6 accounting and banking", () => {
  test("renders accounting control center, periods and journals", async ({ page }) => {
    await loginUi(page);
    await expectWorkspace(page, "/admin/accounting", "Trung tâm kiểm soát kế toán");
    await expectWorkspace(page, "/admin/accounting/periods", "Kỳ kế toán");
    await expect(page.getByText(/kiểm soát kép/i).first()).toBeVisible();
    await expectWorkspace(page, "/admin/accounting/journals", "Sổ nhật ký");
  });

  test("keeps banking evidence bounded while exposing approved reconciliation mutations", async ({ page }) => {
    await ensureAccountingBook();
    await loginUi(page);
    await expectWorkspace(page, "/admin/accounting/reconciliation", "Tài khoản ngân hàng & dữ liệu nhập");
    await expectWorkspace(page, "/admin/accounting/reconciliation/exceptions", "Đối soát & ngoại lệ");
    const bookSelector = page.getByLabel("Sổ kế toán");
    await expect(bookSelector).toBeVisible();
    // The selector omits its placeholder when the server returns exactly one
    // book, so choose the first real option in either shape.
    await expect.poll(async () => bookSelector.locator("option").count()).toBeGreaterThan(0);
    const optionCount = await bookSelector.locator("option").count();
    await bookSelector.selectOption({ index: optionCount > 1 ? 1 : 0 });
    await expect(page.getByText(/Yêu cầu điều chỉnh/i).first()).toBeVisible();
    await expect(page.getByText(/điều chỉnh sổ thủ công.*chưa cung cấp/i)).toHaveCount(0);
    await expectWorkspace(page, "/admin/accounting/statement-snapshots", "Snapshot sao kê");
  });
});
