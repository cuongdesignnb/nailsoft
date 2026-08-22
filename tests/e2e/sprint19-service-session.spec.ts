import { expect, test, type Page } from "@playwright/test";

const sessionId = "77000000-0000-4000-8000-000000000016";

test.use({
  viewport: { width: 1280, height: 800 },
  locale: "vi-VN",
  colorScheme: "light",
  reducedMotion: "reduce",
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/admin/dashboard");
}

test.describe("Service session workspace", () => {
  test("renders realtime service controls and accessible completion dialog", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/admin/service-sessions/${sessionId}`);

    await expect(
      page.getByRole("heading", { name: "Phiên dịch vụ", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Điều khiển phiên dịch vụ" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Checklist thực hiện" }),
    ).toBeVisible();
    await expect(
      page.getByText("Tạm dừng", { exact: true }).first(),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "✓ Hoàn thành dịch vụ", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("dialog", { name: "Hoàn thành dịch vụ" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Xác nhận hoàn thành" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Quay lại" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("stacks the operations workspace without horizontal overflow on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto(`/admin/service-sessions/${sessionId}`);

    await expect(
      page.getByRole("heading", { name: "Phiên dịch vụ", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Dịch vụ trong lịch hẹn" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  });
});
