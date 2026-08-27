import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/deterministic-visual-fixture";
import type { Page } from "@playwright/test";
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
    await expect(page.getByRole("heading", { name: "Danh sách khách hàng", exact: true })).toBeVisible();
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.getByRole("link", { name: "Mở hồ sơ" }).first()).toBeVisible();
    const firstCustomerName = await page.locator(".s19-customer-table tbody tr").first().locator("td strong").innerText();
    await page.getByLabel("Tìm khách hàng").fill(firstCustomerName);
    await page.getByRole("button", { name: "Tìm kiếm" }).click();
    await expect(page.getByRole("link", { name: "Mở hồ sơ" }).first()).toBeVisible();
    await expectA11y(page);
    await page.getByRole("link", { name: "Mở hồ sơ" }).first().click();
    await expect(page.getByRole("heading", { name: "Chi tiết khách hàng" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lịch sử lịch hẹn" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tạo lịch hẹn" }).first()).toBeVisible();
    await expectA11y(page);
  });

  test("reception can create a customer and open its real profile", async ({ page }) => {
    await loginUi(page, "staff3@example.test");
    await page.goto("/admin/customers/new");
    await expect(page.getByRole("heading", { name: "Tạo khách hàng mới" })).toBeVisible();
    await page.getByRole("button", { name: "Lưu khách hàng" }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: "Vui lòng nhập họ và tên" })).toBeVisible();
    const name = unique("Customer360");
    await page.getByLabel("Họ và tên").fill(name);
    await page.locator("#customer-phone").fill(`090${Date.now().toString().slice(-7)}`);
    await page.locator("#customer-email").fill(`${name.toLowerCase()}@example.test`);
    await page.getByRole("button", { name: "Lưu & mở hồ sơ" }).click();
    await expect(page).toHaveURL(/\/admin\/customers\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Chi tiết khách hàng" })).toBeVisible();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  });

  test("customer engagement route renders the Customer Care timeline", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto(`/admin/customers/${seededCustomer}/engagement`);
    await expect(page.getByRole("heading", { name: "Lịch sử liên hệ & chăm sóc" })).toBeVisible();
  });

  test("technician and platform users receive the forbidden state", async ({ page }) => {
    await loginUi(page, "staff5@example.test");
    await page.goto("/admin/customers");
    await expect(page.getByRole("heading", { name: "Không có quyền truy cập", exact: true })).toBeVisible();

    await page.evaluate(() => localStorage.clear());
    await loginUi(page, "platform-e2e@example.test");
    await page.goto(`/admin/customers/${seededCustomer}`);
    await expect(page.getByRole("alert").filter({ hasText: "Không có quyền xem hồ sơ" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Danh sách khách hàng", exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
