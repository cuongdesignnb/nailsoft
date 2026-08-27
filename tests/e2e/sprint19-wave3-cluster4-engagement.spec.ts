import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/deterministic-visual-fixture";
import type { Page } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { headers } from "./helpers/api-client";

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

test.describe.serial("Sprint 19 Wave 3 Cluster 4 engagement workspace", () => {
  test("owner can open communications, marketing, reviews and recovery screens", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    for (const [path, heading] of [
      ["/admin/communications/templates", "Mẫu Email"],
      ["/admin/communications/rules", "Quy tắc gửi"],
      ["/admin/communications/messages", "Giao nhận Email"],
      ["/admin/communications/suppressions", "Danh sách Email bị chặn"],
      ["/admin/marketing/segments", "Nhóm khách hàng"],
      ["/admin/marketing/campaigns", "Marketing khách hàng"],
      ["/admin/reviews", "Đánh giá khách hàng"],
      ["/admin/review-requests", "Yêu cầu đánh giá"],
      ["/admin/service-recovery", "Service Recovery"],
    ] as const) {
      await page.goto(path);
      await expect(page.locator("h1").filter({ hasText: heading })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    }
    await expect(page.getByText("Chỉ Email", { exact: false }).first()).toBeVisible();
    await expectA11y(page);
  });

  test("owner can inspect seeded campaign and recovery detail without raw secrets", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto("/admin/marketing/campaigns/e9100000-0000-4000-8000-000000000001");
    await expect(page.locator("h1").filter({ hasText: "July welcome fixture" })).toBeVisible();
    await expect(page.getByText(/consent and suppression/i).first()).toBeVisible();
    await page.goto("/admin/service-recovery/e5000000-0000-4000-8000-000000000001");
    await expect(page.getByRole("heading", { name: "Đang mở", exact: true })).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/password|provider[_ -]?token|secret|code_hash/i);
    await expectA11y(page);
  });

  test("technician and platform users are denied by API permission, not hidden-menu assumptions", async () => {
    const technician = await authenticated("technicianA");
    const platform = await authenticated("platform");
    try {
      expect((await technician.api.get("/v1/marketing-campaigns", { headers: headers(technician) })).status()).toBe(403);
      expect((await platform.api.get("/v1/service-recovery/cases", { headers: headers(platform) })).status()).toBe(403);
    } finally {
      await close(technician);
      await close(platform);
    }
  });

  test("customer care global and scoped routes render without fake email metrics", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto("/admin/customer-care");
    await expect(page.getByRole("heading", { name: "Lịch sử liên hệ & chăm sóc", exact: true })).toBeVisible();
    const globalBody = await page.locator("body").innerText();
    expect(globalBody).not.toMatch(/Đã mở|Tỷ lệ mở email|SMS/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await expectA11y(page);

    await page.goto("/admin/customers/60000000-0000-4000-8000-000000000001/engagement");
    await expect(page.getByRole("heading", { name: "Lịch sử liên hệ & chăm sóc", exact: true })).toBeVisible();
    const customerBody = await page.locator("body").innerText();
    expect(customerBody).not.toMatch(/Đã mở|Tỷ lệ mở email|SMS/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await expectA11y(page);
  });
});
