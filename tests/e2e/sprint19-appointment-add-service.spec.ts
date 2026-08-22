import { expect, test, type Page } from "@playwright/test";

const appointmentId = "70000000-0000-4000-8000-000000000010";

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

test.describe("Appointment add-service UI", () => {
  test("renders the controlled add-service workspace and blocks an ineligible appointment", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/admin/appointments/${appointmentId}/add-service`);

    await expect(
      page.getByRole("heading", { name: "Thêm dịch vụ", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "A. Dịch vụ trong lịch hẹn" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "B. Chọn dịch vụ muốn thêm" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "G. Xác nhận thêm dịch vụ" }),
    ).toBeVisible();
    await expect(page.getByText(/chưa cho phép thêm dịch vụ/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Xác nhận thêm dịch vụ" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  });

  test("keeps the catalog and context usable on mobile without horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto(`/admin/appointments/${appointmentId}/add-service`);

    await expect(
      page.getByRole("heading", { name: "Thêm dịch vụ", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Tìm dịch vụ" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  });
});
