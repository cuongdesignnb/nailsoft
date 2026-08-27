import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { headers } from "./helpers/api-client";

const branch = "20000000-0000-4000-8000-000000000001";

async function login(page: import("@playwright/test").Page) {
  await page.goto("http://localhost:3000/auth/login");
  await page.locator('input[name="email"]').fill("staff3@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await page.locator("form button").click();
  await expect(page.getByRole("status")).toBeVisible();
}

test("Reception uses the real operational board and walk-in lifecycle UI", async ({
  page,
}) => {
  await login(page);
  await page.goto("http://localhost:3000/admin/operations/board");
  await expect(
    page.getByRole("heading", { name: "Operational board" }),
  ).toBeVisible();
  await page.getByLabel("Branch").selectOption(branch);
  await expect(page.getByText(/Phiên bản dữ liệu/)).toBeVisible();

  await page.goto("http://localhost:3000/admin/operations/walk-ins/new");
  await page.getByLabel("Branch").selectOption(branch);
  await page.getByLabel("Display name").fill(`E2E Walk-in ${Date.now()}`);
  await page.getByLabel("Service").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create queue entry" }).click();
  await expect(page.getByRole("heading", { name: /Queue #/ })).toBeVisible();
  await page.getByRole("button", { name: "Ready" }).click();
  const call = page.getByRole("button", { name: "Call" });
  await expect(call).toBeVisible();
  await call.click();
  await expect(page.locator("p").filter({ hasText: "CALLED" })).toBeVisible();
});

test("Authenticated operational API is branch scoped and exposes checkout preview only", async () => {
  const receptionist = await authenticated("receptionist");
  try {
    const board = await receptionist.api.get(
      `/v1/operations/board?branchId=${branch}`,
      { headers: headers(receptionist) },
    );
    expect(board.status()).toBe(200);
    const body = await board.json();
    expect(body.data.columns).toHaveProperty("READY_FOR_CHECKOUT");
    expect(body.data).not.toHaveProperty("invoice");
    expect(body.data).not.toHaveProperty("payment");
  } finally {
    await close(receptionist);
  }
});
