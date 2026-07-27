import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const periodId = "b2000000-0000-4000-8000-000000000001";

async function loginUi(page: import("@playwright/test").Page) {
  await page.goto("http://localhost:3000/auth/login");
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await page.locator("form button").click();
  await expect(page.getByRole("status")).toBeVisible();
}

test("owner reviews and locks a commission period while technician remains own-scope", async ({
  page,
}) => {
  await loginUi(page);
  await page.goto(`http://localhost:3000/admin/commission/periods/${periodId}`);
  await expect(
    page.getByRole("heading", { name: "Commission period" }),
  ).toBeVisible();
  await expect(page.getByText(/SEED-OPEN-01/)).toBeVisible();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText(/SEED-OPEN-01.*REVIEW/)).toBeVisible();
  await page.getByRole("button", { name: "Lock evidence" }).click();
  await expect(page.getByText(/SEED-OPEN-01.*LOCKED/)).toBeVisible();

  const technician = await login("staff5@example.test");
  try {
    const own = await technician.api.get("/v1/staff/me/commissions", {
      headers: headers(technician),
    });
    expect(own.status()).toBe(200);
    const all = await technician.api.get("/v1/commission-entries", {
      headers: headers(technician),
    });
    expect(all.status()).toBe(403);
  } finally {
    await close(technician);
  }
});
