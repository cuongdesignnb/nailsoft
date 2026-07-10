import { expect, test } from "@playwright/test";

test("Admin Web exposes secure authentication routes without seeded credentials", async ({ page }) => {
  await page.goto("/auth/login");
  await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeEnabled();
  await page.goto("/auth/forgot-password");
  await expect(page.getByRole("heading", { name: "Forgot password" })).toBeVisible();
  await page.goto("/auth/mfa");
  await expect(page.getByRole("heading", { name: "Additional verification" })).toBeVisible();
});

test("operational routes render responsive loading and recovery states", async ({ page }) => {
  await page.route("http://localhost:3001/**", async (route) => route.fulfill({ status: 401, body: JSON.stringify({ error: { code: "SESSION_REVOKED" } }) }));
  await page.goto("/admin/team/users");
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Permission required" })).toBeVisible();
  await page.goto("/admin/organization/branches/new");
  await expect(page.getByRole("heading", { name: "Create branch" })).toBeVisible();
});
