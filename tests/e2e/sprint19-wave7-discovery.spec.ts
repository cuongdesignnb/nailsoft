import { expect, test } from "./helpers/deterministic-visual-fixture";
import AxeBuilder from "@axe-core/playwright";

const bookingWeb = "http://127.0.0.1:3002";

test.describe("Sprint 19 Wave 7 public discovery", () => {
  test("keeps the landing tenant-neutral and opens a real salon flow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(bookingWeb);
    await expect(page.getByRole("heading", { name: /Thời gian|Time reserved/ })).toBeVisible();
    await expect(page.locator('a[href="/book/nailsoft-demo"]')).toHaveCount(0);

    await page.locator(".landing-language select").selectOption("en-US");
    await expect(page.getByRole("button", { name: /Start booking/ })).toBeVisible();
    await page.getByLabel(/Salon code/).fill("nailsoft-demo");
    await page.getByRole("button", { name: /Start booking/ }).click();
    await expect(page).toHaveURL(/\/book\/nailsoft-demo/);
    await expect(page.locator('[data-testid="public-booking-flow"]')).toBeVisible();

    await expect(page.getByRole("heading", { name: /Select a branch|Chọn chi nhánh/ })).toBeVisible();
    const branchButtons = page.locator(".choice-card");
    await expect(branchButtons.first()).toBeVisible();
    await branchButtons.first().click();

    await expect(page.getByRole("heading", { name: /Select services|Chọn dịch vụ/ }).first()).toBeVisible();
    const serviceCards = page.locator(".choice-card");
    await expect(serviceCards.first()).toContainText(/SVC|VND|₫|\$/);
    await serviceCards.first().click();
    if (await serviceCards.count() > 1) await serviceCards.nth(1).click();
    await expect(page.locator(".badge").first()).toContainText(/\//);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(overflow).toBe(true);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  });
});
