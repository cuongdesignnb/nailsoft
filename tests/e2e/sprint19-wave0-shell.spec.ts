import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { authenticated, close } from "./auth/setup";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/admin/dashboard");
  await page.goto("/admin/design-system");
  await expect(page.getByRole("heading", { name: /Design system|Hệ thống thiết kế/ })).toBeVisible();
}

test.describe("Sprint 19 Wave 0 shells", () => {
  test("component gallery has a ready baseline, focus evidence and no axe violations", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: /Revenue by day|Doanh thu theo ngày/ }).first()).toBeVisible();
    const evidence = resolve("artifacts/sprint19/screens/19.0.11");
    await mkdir(evidence, { recursive: true });
    const skipLink = page.locator(".ns-skip-link");
    expect(await skipLink.evaluate((element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.top.startsWith("-") && rect.bottom < 0; })).toBeTruthy();
    await page.screenshot({ path: resolve(evidence, "gallery-desktop-ready.png"), fullPage: true, animations: "disabled" });
    await expect(page).toHaveScreenshot("sprint19-wave0-gallery-ready.png", { fullPage: true, animations: "disabled" });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await page.screenshot({ path: resolve(evidence, "gallery-skip-link-focus.png"), fullPage: true, animations: "disabled" });
    await skipLink.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("gallery remains usable across required responsive viewports and locales", async ({ page }) => {
    await signIn(page);
    const evidence = resolve("artifacts/sprint19/screens/19.0.11");
    await mkdir(evidence, { recursive: true });
    const viewports = [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "desktop-1280", width: 1280, height: 800 }, { name: "tablet-1024", width: 1024, height: 768 }, { name: "tablet-768", width: 768, height: 1024 }, { name: "mobile-390", width: 390, height: 844 }, { name: "mobile-360", width: 360, height: 800 }];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(page.getByRole("button", { name: /Primary action|Thao tác chính/ })).toBeVisible();
      const overflow = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map((element) => ({ tag: element.tagName, className: element.className, right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) })));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify({ viewport, overflow })).toBeTruthy();
      await page.screenshot({ path: resolve(evidence, `${viewport.name}-vi.png`), fullPage: true, animations: "disabled" });
    }
    await page.locator("#gallery-locale").selectOption("en-US");
    await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
    await page.screenshot({ path: resolve(evidence, "gallery-desktop-en-US.png"), fullPage: true, animations: "disabled" });
    await page.locator("#gallery-locale").selectOption("vi-VN");
    await expect(page.getByRole("heading", { name: "Hệ thống thiết kế" })).toBeVisible();
    await page.screenshot({ path: resolve(evidence, "gallery-desktop-vi-VN.png"), fullPage: true, animations: "disabled" });
  });

  test("authenticated context returns effective permissions and never grants platform branch data without a support grant", async () => {
    const owner = await authenticated("owner");
    const platform = await authenticated("platform");
    try {
      const ownerResponse = await owner.api.get("/v1/auth/context", { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId } });
      expect(ownerResponse.status()).toBe(200);
      const ownerBody = await ownerResponse.json();
      expect(ownerBody.data.authorization.permissions.length).toBeGreaterThan(0);
      expect(ownerBody.data.authorization.roles).toContain("SALON_OWNER");
      const platformResponse = await platform.api.get("/v1/auth/context", { headers: { authorization: `Bearer ${platform.accessToken}`, "x-tenant-id": platform.tenantId } });
      expect(platformResponse.status()).toBe(200);
      const platformBody = await platformResponse.json();
      if (platformBody.data.authorization.roles.includes("PLATFORM_SUPER_ADMIN") && !platformBody.data.supportAccess) expect(platformBody.data.branches).toEqual([]);
    } finally { await close(owner); await close(platform); }
  });
});
