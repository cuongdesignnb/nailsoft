import { expect, test } from "@playwright/test";

test("authenticated Admin Web exposes real appointment operations", async ({
  page,
}) => {
  await page.goto("http://localhost:3000/auth/login");
  await page.locator('input[name="email"]').fill("staff3@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await page.locator("form button").click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto("http://localhost:3000/admin/appointments");
  await expect(
    page.getByRole("heading", { name: "Appointments" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create appointment" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await page.goto("http://localhost:3000/admin/appointments/new");
  await expect(
    page.getByRole("heading", { name: "Quick create" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find availability" }),
  ).toBeEnabled();
});

test("public booking is mobile-first and exposes availability without an account", async ({
  page,
}) => {
  await page.goto("http://localhost:3002/book/nailsoft-demo");
  await expect(
    page.getByRole("heading", { name: "Chọn dịch vụ của bạn." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Quận 1|Quáº­n 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Quản lý lịch hẹn" }),
  ).toBeVisible();
  await page.goto("http://localhost:3002/manage-booking");
  await expect(
    page.getByRole("heading", { name: "Quản lý lịch hẹn." }),
  ).toBeVisible();
  await expect(page.getByLabel("Mã lịch hẹn")).toBeVisible();
});
