import { expect, test } from "./helpers/deterministic-visual-fixture";
import AxeBuilder from "@axe-core/playwright";

const bookingWeb = "http://127.0.0.1:3002";

test.describe("Sprint 19 Wave 7 public booking visual/accessibility smoke", () => {
  for (const viewport of [
    { name: "mobile-390", width: 390, height: 844 },
    { name: "mobile-360", width: 360, height: 800 },
    { name: "desktop-1280", width: 1280, height: 800 },
  ]) {
    test(`${viewport.name} has no overflow and no serious axe violations`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.goto(`${bookingWeb}/book/nailsoft-demo`);
      await expect(page.locator('[data-testid="public-booking-flow"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const accessibility = await new AxeBuilder({ page }).analyze();
      const serious = accessibility.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
      expect(serious).toEqual([]);
      await testInfo.attach(`${viewport.name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
});
