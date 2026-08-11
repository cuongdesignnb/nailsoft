import { expect, test } from "@playwright/test";

test.describe("Sprint 19 Wave 9 Staff Mobile public shell", () => {
  test("loads tenant-neutral sign-in without a production tenant", async ({ page }) => {
    await page.goto("http://127.0.0.1:3004/");
    await expect(page.getByText("NAILSOFT STAFF")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });
});
