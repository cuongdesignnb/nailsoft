import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { headers } from "./helpers/api-client";
import { unique } from "./helpers/test-data";

const seededCustomer = "60000000-0000-4000-8000-000000000001";

async function loginUi(page: Page, email: string) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function expectA11y(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe.serial("Sprint 19 Wave 3 Customer 360", () => {
  test("owner can search, paginate and open the real Customer 360 profile", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto("/admin/customers");
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open customer" }).first()).toBeVisible();
    const firstCustomerName = await page.locator(".s19-customer-table tbody tr").first().locator("td strong").innerText();
    await page.getByLabel("Search customers").fill(firstCustomerName);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("link", { name: "Open customer" }).first()).toBeVisible();
    await expectA11y(page);
    await page.getByRole("link", { name: "Open customer" }).first().click();
    await expect(page.getByRole("heading", { name: "Customer profile" })).toBeVisible();
    await expect(page.getByText("Customer profile editing is not available in this release.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Activity summary" })).toBeVisible();
    await expectA11y(page);
  });

  test("reception can create a customer, while unsupported profile mutation is absent", async ({ page }) => {
    await loginUi(page, "staff3@example.test");
    await page.goto("/admin/customers/new");
    await expect(page.getByRole("heading", { name: "Create customer" })).toBeVisible();
    await page.getByRole("button", { name: "Create customer" }).click();
    await expect(page.locator(".s19-notice-error").filter({ hasText: "Display name is required" })).toBeVisible();
    const name = unique("Customer360");
    await page.getByLabel("Display name").fill(name);
    await page.getByLabel("Phone").fill(`090${Date.now().toString().slice(-7)}`);
    await page.getByLabel("Email").fill(`${name.toLowerCase()}@example.test`);
    await page.getByRole("button", { name: "Create customer" }).click();
    await expect(page).toHaveURL(/\/admin\/customers\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Customer profile" })).toBeVisible();
    await expect(page.getByText("Customer profile editing is not available in this release.")).toBeVisible();
  });

  test("customer engagement remains owned by the Sprint 11 renderer", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto(`/admin/customers/${seededCustomer}/engagement`);
    await expect(page.getByRole("heading", { name: "Customer engagement timeline" })).toBeVisible();
  });

  test("technician and platform users receive the forbidden state", async ({ page }) => {
    await loginUi(page, "staff5@example.test");
    await page.goto("/admin/customers");
    await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();

    await page.evaluate(() => localStorage.clear());
    await loginUi(page, "platform-e2e@example.test");
    await page.goto(`/admin/customers/${seededCustomer}`);
    await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
  });

  test("API contract keeps tenant-safe detail and optional financial sections", async () => {
    const owner = await authenticated("owner");
    const technician = await authenticated("technicianA");
    const platform = await authenticated("platform");
    try {
      const ownerDetail = await owner.api.get(`/v1/customers/${seededCustomer}`, { headers: headers(owner) });
      expect(ownerDetail.status()).toBe(200);
      const ownerBody = await ownerDetail.json();
      expect(ownerBody.data.contact.access).toBe("FULL");
      expect(ownerBody.data.recentPurchases).toEqual(expect.objectContaining({ access: expect.any(String) }));
      expect(ownerBody.data.recentRefunds).toEqual(expect.objectContaining({ access: expect.any(String) }));
      expect(JSON.stringify(ownerBody)).not.toContain("phone_normalized");
      expect(JSON.stringify(ownerBody)).not.toContain("email_normalized");

      expect((await technician.api.get(`/v1/customers/${seededCustomer}`, { headers: headers(technician) })).status()).toBe(403);
      expect((await platform.api.get(`/v1/customers/${seededCustomer}`, { headers: headers(platform) })).status()).toBe(403);
      expect((await owner.api.get("/v1/customers/60000000-0000-4000-8000-000000000099", { headers: headers(owner) })).status()).toBe(404);
    } finally {
      await close(owner);
      await close(technician);
      await close(platform);
    }
  });

  test("directory is responsive without horizontal document overflow", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/customers");
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
