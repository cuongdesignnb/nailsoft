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

test("Cashier completes the real POS, split-safe payment and immutable receipt UI", async ({
  page,
}) => {
  await loginUi(page, "cashier@example.test");
  await page.goto(`http://localhost:3000/admin/pos/orders/${draftOrder}`);
  await expect(
    page.getByRole("heading", { name: "Order detail" }),
  ).toBeVisible();
  await expect(page.getByText("POS-SEED-DRAFT")).toBeVisible();

  const discount = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Discount" }) });
  await discount.locator('input[name="value"]').fill("10000");
  await discount
    .getByRole("button", { name: "Apply / request approval" })
    .click();
  await expect(page.getByText("Discount applied.")).toBeVisible();

  const tip = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Tip" }) });
  await tip.locator('input[name="amountMinor"]').fill("10000");
  await tip.getByRole("button", { name: "Set and allocate tip" }).click();
  await expect(
    page.getByText("Tip allocated from actual work segments."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Finalize order" }).click();
  await expect(
    page.getByText("Order finalized. Pricing mutations are closed."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Collect payment" }).click();
  await expect(
    page.getByRole("heading", { name: "Collect payment" }),
  ).toBeVisible();
  await page.getByLabel("Tender").selectOption("CARD_EXTERNAL");
  await page
    .getByLabel("External reference")
    .fill(`e2e-terminal-${Date.now()}`);
  await page.getByLabel("Card last 4 only").fill("4242");
  await page.getByRole("button", { name: "Capture once" }).click();
  await expect(
    page.getByText("External payment evidence recorded.", { exact: true }),
  ).toBeVisible();

  await page.goto(`http://localhost:3000/admin/pos/orders/${draftOrder}`);
  await expect(page.getByText(/PAID · version/)).toBeVisible();
  await page.getByRole("link", { name: "Open immutable receipt" }).click();
  await expect(page.getByRole("heading", { name: "Receipt" })).toBeVisible();
  await expect(page.getByText(/Q1-\d{4}-\d{6}/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print receipt" }),
  ).toBeVisible();
});

test("Cash register views expose real seeded data and permission state", async ({
  page,
}) => {
  await loginUi(page, "cashier@example.test");
  await page.goto("http://localhost:3000/admin/pos/registers");
  await expect(
    page.getByRole("heading", { name: "Registers and drawers" }),
  ).toBeVisible();
  await expect(page.getByText(/Q1-POS-01/)).toBeVisible();
  await expect(page.getByText(/Q1-DRAWER-01/)).toBeVisible();

  await page.goto("http://localhost:3000/admin/pos/cash-sessions");
  await expect(
    page.getByRole("heading", { name: "Cash sessions" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await loginUi(page, "staff5@example.test");
  await page.goto("http://localhost:3000/admin/pos");
  await expect(
    page.getByRole("heading", { name: "Permission denied" }).first(),
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
