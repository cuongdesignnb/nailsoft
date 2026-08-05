import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const seededOrder = "a4000000-0000-4000-8000-000000000001";

async function loginUi(page: import("@playwright/test").Page, email = "cashier@example.test") {
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await page.locator("form button").click();
  await expect(page.getByRole("status")).toBeVisible();
}

async function assertAccessible(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe("Sprint 19 Wave 2 POS, payment and cash surfaces", () => {
  test("POS home exposes branch/register context and responsive actions", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/pos");
    await expect(page.getByRole("heading", { name: "Front desk control centre" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New sale" })).toBeVisible();
    await expect(page.getByLabel("Working branch")).toBeVisible();
    await assertAccessible(page);
    await page.screenshot({ path: test.info().outputPath("pos-sale-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("body")).toHaveCSS("overflow-x", "visible");
    await page.screenshot({ path: test.info().outputPath("pos-sale-mobile.png"), fullPage: true });
  });

  test("real order detail keeps server totals and legacy command affordances", async ({ page }) => {
    await loginUi(page);
    await page.goto(`/admin/pos/orders/${seededOrder}`);
    await expect(page.getByRole("heading", { name: "Order detail" })).toBeVisible();
    await expect(page.getByText("POS-SEED-DRAFT")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Order summary" })).toBeVisible();
    await expect(page.getByText("SERVER TOTALS")).toBeVisible();
    await assertAccessible(page);
  });

  test("split-tender payment surface shows explicit payment recovery state", async ({ page }) => {
    await loginUi(page);
    await page.goto(`/admin/pos/orders/${seededOrder}/payment`);
    await expect(page.getByRole("heading", { name: "Collect payment" })).toBeVisible();
    await expect(page.getByLabel("Tender")).toBeVisible();
    await expect(page.getByRole("button", { name: "Capture once" })).toBeVisible();
    await assertAccessible(page);
    await page.screenshot({ path: test.info().outputPath("split-tender-checkout.png"), fullPage: true });
  });

  test("register close and refund review routes are real API-backed surfaces", async ({ page }) => {
    await loginUi(page, "staff2@example.test");
    await page.goto("/admin/pos/registers");
    await expect(page.getByRole("heading", { name: "Registers and drawers" })).toBeVisible();
    await page.goto("/admin/refunds/new");
    await expect(page.getByRole("heading", { name: "Refund initiation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview refund" })).toBeVisible();
    await assertAccessible(page);
    await page.screenshot({ path: test.info().outputPath("refund-review.png"), fullPage: true });
  });
});
