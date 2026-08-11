import { expect, test } from "@playwright/test";

test.describe("Sprint 19 Wave 9 Staff Mobile visual and accessibility smoke", () => {
  test("captures deterministic sign-in shell states", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://127.0.0.1:3004/");
    await expect(page.getByText("NAILSOFT STAFF")).toBeVisible();
    await page.screenshot({ path: "test-results/sprint19-wave9-staff-login-390.png", fullPage: true });
    expect(await page.locator("body").evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
