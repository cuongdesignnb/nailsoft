import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ownerMobile = "http://127.0.0.1:3003";

test.describe("Sprint 19 Wave 8 Owner Mobile visual and accessibility E2E", () => {
  for (const viewport of [
    { name: "mobile-390", width: 390, height: 844 },
    { name: "mobile-360", width: 360, height: 800 },
  ]) {
    test(`${viewport.name} login shell is responsive and accessible`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${ownerMobile}/`);
      await expect(page.getByText("NAILSOFT OWNER")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
      await testInfo.attach(`${viewport.name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
});
