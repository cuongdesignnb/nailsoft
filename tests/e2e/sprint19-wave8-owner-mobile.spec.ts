import { expect, test } from "@playwright/test";

const ownerMobile = "http://127.0.0.1:3003";

test.describe("Sprint 19 Wave 8 Owner Mobile authenticated and contract E2E", () => {
  test("starts at a tenant-neutral login boundary", async ({ page }) => {
    await page.goto(`${ownerMobile}/`);
    await expect(page.getByText("NAILSOFT OWNER")).toBeVisible();
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("tenantSlug"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("workspaceToken"))).toBeNull();
  });
});
