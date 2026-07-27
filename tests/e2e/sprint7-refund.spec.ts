import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const refundId = "b3000000-0000-4000-8000-000000000001";

async function loginUi(page: import("@playwright/test").Page) {
  await page.goto("http://localhost:3000/auth/login");
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await page.locator("form button").click();
  await expect(page.getByRole("status")).toBeVisible();
}

test("owner reviews and approves a real immutable refund request", async ({
  page,
}) => {
  await loginUi(page);
  await page.goto("http://localhost:3000/admin/refunds");
  await expect(
    page.getByRole("heading", { name: "Refund ledger" }),
  ).toBeVisible();
  await expect(page.getByText("RF-Q1-SEED-000001")).toBeVisible();
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Refund detail" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(
    page.getByText("approve completed.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible();

  const manager = await login("staff2@example.test");
  try {
    const detail = await manager.api.get(`/v1/refunds/${refundId}`, {
      headers: headers(manager),
    });
    expect(detail.status()).toBe(200);
    expect((await detail.json()).data.status).toBe("APPROVED");
  } finally {
    await close(manager);
  }
});
