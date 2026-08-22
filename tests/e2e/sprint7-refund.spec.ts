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
    page.getByRole("heading", { name: "Hoàn tiền", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("RF-Q1-SEED-000001", { exact: true }).first(),
  ).toBeVisible();
  await page.goto(`http://localhost:3000/admin/refunds/${refundId}`);
  await expect(
    page.getByRole("heading", { name: "Chi tiết hoàn tiền" }),
  ).toBeVisible();
  await page
    .getByLabel("Lý do phê duyệt / từ chối / hủy")
    .fill("Đã kiểm tra chứng từ hoàn tiền");
  const approveResponse = page.waitForResponse((response) => response.url().includes(`/v1/refunds/${refundId}/approve`));
  await page.getByRole("button", { name: "Phê duyệt" }).first().click();
  const approvedHttp = await approveResponse;
  expect(approvedHttp.status()).toBe(201);
  await expect(
    page.getByText(/Đã cập nhật yêu cầu hoàn tiền/),
  ).toBeVisible();
  await expect(
    page.getByText("Đã duyệt", { exact: true }).first(),
  ).toBeVisible();

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
