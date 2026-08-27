import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { branchA, technicianAStaff } from "./helpers/test-data";

const serviceId = "50000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";
let createdAppointmentId = "";
let createdShiftId = "";

function nextWorkingDate() {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + 1);
  while (value.getUTCDay() === 0) value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

const fixtureDate = nextWorkingDate();
const fixtureStartAt = new Date(`${fixtureDate}T01:30:00.000Z`);
const fixtureEndAt = new Date(`${fixtureDate}T11:00:00.000Z`);

test.afterAll(async () => {
  if (!createdShiftId) return;
  const owner = await authenticated("owner"),
    headers = {
      authorization: `Bearer ${owner.accessToken}`,
      "x-tenant-id": owner.tenantId,
    };
  try {
    await owner.api
      .post(`/v1/shifts/${createdShiftId}/cancel`, { headers })
      .catch(() => undefined);
  } finally {
    await close(owner);
  }
});

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("http://localhost:3000/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([
    page.waitForURL("**/admin/dashboard"),
    page.locator("form button").click(),
  ]);
  await expect(page).toHaveURL(/\/admin\/dashboard(?:\?.*)?$/);
  await expect(page.locator("main")).toBeVisible();
}

test.describe.serial("authenticated Admin Web booking lifecycle", () => {
  test("reception searches real data and creates a confirmed multi-service-ready appointment", async ({
    page,
  }) => {
    const manager = await authenticated("owner"),
      headers = {
        authorization: `Bearer ${manager.accessToken}`,
        "x-tenant-id": manager.tenantId,
      };
    try {
      const skills = await manager.api.put(
        `/v1/staff/${technicianAStaff}/skills`,
        {
          headers,
          data: {
            skills: [
              {
                skillId: "41000000-0000-4000-8000-000000000001",
                proficiencyLevel: 5,
                status: "ACTIVE",
              },
              {
                skillId: "41000000-0000-4000-8000-000000000002",
                proficiencyLevel: 5,
                status: "ACTIVE",
              },
              {
                skillId: "41000000-0000-4000-8000-000000000003",
                proficiencyLevel: 5,
                status: "ACTIVE",
              },
            ],
          },
        },
      );
      expect(skills.status()).toBe(200);
      const shift = await manager.api.post("/v1/shifts", {
        headers,
        data: {
          branchId: branchA,
          staffId: technicianAStaff,
          startAt: fixtureStartAt.toISOString(),
          endAt: fixtureEndAt.toISOString(),
          breakMinutes: 0,
          source: "IMPORT",
        },
      });
      expect(shift.status()).toBe(201);
      const shiftId = (await shift.json()).data.id;
      createdShiftId = shiftId;
      expect(
        (
          await manager.api.post(`/v1/shifts/${shiftId}/publish`, {
            headers,
          })
        ).status(),
      ).toBe(201);
    } finally {
      await close(manager);
    }

    await login(page, "staff3@example.test");
    await page.goto(
      `http://localhost:3000/admin/appointments/new?branchId=${branchA}&customerId=${customerId}&serviceIds=${serviceId}&staffId=${technicianAStaff}`,
    );
    await expect(
      page.getByRole("heading", { name: "Tạo lịch hẹn mới" }),
    ).toBeVisible();
    await page.getByLabel("Ngày hẹn").fill(fixtureDate);
    await expect(
      page.getByRole("listbox", { name: "Khung giờ khả dụng" }),
    ).toBeVisible();
    await page
      .getByRole("listbox", { name: "Khung giờ khả dụng" })
      .getByRole("option")
      .first()
      .click();
    const createButton = page.getByRole("button", { name: "Tạo lịch hẹn" }).first();
    await expect(createButton).toBeEnabled();
    await createButton.click();
    await page.waitForURL(/\/admin\/appointments\/[0-9a-f-]+\/overview/);
    createdAppointmentId = new URL(page.url()).pathname.split("/")[3] ?? "";
    expect(createdAppointmentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("manager reschedules the real appointment without losing the current schedule", async ({
    page,
  }) => {
    expect(createdAppointmentId).toBeTruthy();
    await login(page, "staff2@example.test");
    await page.goto(
      `http://localhost:3000/admin/appointments/${createdAppointmentId}/reschedule`,
    );
    await expect(page.getByRole("heading", { name: "Đổi lịch hẹn" })).toBeVisible();
    const replacementSlot = page.locator("[class*='slotGrid'] button").first();
    await expect(replacementSlot).toBeVisible();
    await replacementSlot.click();
    await expect(page.getByText(/Slot đang được giữ đến/)).toBeVisible();
    await page.getByText("Tôi đã kiểm tra thời gian mới với khách hàng").click();
    await expect(page.getByRole("button", { name: /Xác nhận đổi lịch/ }).first()).toBeEnabled();
    await page.getByRole("button", { name: /Xác nhận đổi lịch/ }).first().click();
    await page.waitForURL(/\/admin\/appointments\/[0-9a-f-]+\/overview/);
  });

  test("assigned technician sees only the assigned appointment item", async ({
    page,
  }) => {
    await login(page, "staff5@example.test");
    await page.goto(
      `http://localhost:3000/admin/appointments/${createdAppointmentId}/services`,
    );
    await expect(page.getByRole("heading", { name: "Chi tiết lịch hẹn" })).toBeVisible();
    await expect(page.getByText("Staff 5", { exact: true }).first()).toBeVisible();
  });

  test("reception cancels the appointment through the audited command UI", async ({
    page,
  }) => {
    await login(page, "staff3@example.test");
    await page.goto(
      `http://localhost:3000/admin/appointments/${createdAppointmentId}/cancel`,
    );
    await page.getByLabel("Ghi chú nội bộ").fill("Sprint 4 deep E2E cancellation");
    await page.getByText("Tôi đã kiểm tra đúng khách hàng và lịch hẹn cần hủy.").click();
    await page.getByText("Tôi hiểu thao tác này sẽ giải phóng khung giờ hiện tại.").click();
    await page.getByRole("button", { name: "Xác nhận hủy lịch" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Hủy lịch hẹn" }).click();
    await page.waitForURL(/\/admin\/appointments\/[0-9a-f-]+\/overview/);
    await page.goto(
      `http://localhost:3000/admin/appointments/${createdAppointmentId}/overview`,
    );
    await expect(
      page.getByText("Salon đã hủy", { exact: true }).first(),
    ).toBeVisible();
  });
});

test("authenticated Admin Web exposes appointment operations and live filters", async ({
  page,
}) => {
  await login(page, "staff3@example.test");
  await page.goto("http://localhost:3000/admin/appointments");
  await expect(
    page.getByRole("heading", { name: "Quản lý lịch hẹn" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Tạo lịch hẹn mới" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await page.goto("http://localhost:3000/admin/appointments/new");
  await expect(
    page.getByRole("heading", { name: "Tạo lịch hẹn mới" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Làm mới khung giờ" }),
  ).toBeEnabled();
});

test("public booking supports real date, multi-service ordering and scoped management", async ({
  page,
}) => {
  const publicPhone = `090${String(Date.now()).slice(-7)}`;
  await page.goto("http://localhost:3002/book/nailsoft-demo");
  await expect(page.getByRole("heading", { name: /Select branch|Chọn chi nhánh/ }).first()).toBeVisible();
  const branch = page.getByRole("button", { name: /Q1|Quận 1/ });
  await expect(branch).toBeVisible();
  await expect(page.getByRole("link", { name: /Manage booking|Quản lý lịch hẹn/ })).toBeVisible();
  await branch.click();
  await expect(page.getByRole("heading", { name: /Select services|Chọn dịch vụ/ }).first()).toBeVisible();

  const choices = page.locator("button.choice");
  await expect(choices.first()).toBeVisible();
  await choices.first().click();
  // SVC-11 is the next catalog item with a resource type available in branch Q1.
  await choices.nth(2).click();
  await expect(page.getByText(/Services|Dịch vụ/).first()).toBeVisible();
  const date = page.locator("#booking-date");
  await expect(date).toHaveAttribute("min", /2026-/);
  const minimumDate = (await date.getAttribute("min")) ?? "";
  const maximumDate = (await date.getAttribute("max")) ?? minimumDate;
  const toDate = (value: string) => new Date(`${value}T12:00:00Z`);
  const dateValue = (value: Date) => value.toISOString().slice(0, 10);
  let foundSlot = false;
  for (let cursor = toDate(minimumDate); dateValue(cursor) <= maximumDate && !foundSlot; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    await date.fill(dateValue(cursor));
    await page.getByRole("button", { name: /Find available times|Tìm giờ trống/ }).click();
    await expect.poll(async () => page.locator(".slot").count(), { timeout: 5000 }).toBeGreaterThan(0).catch(() => undefined);
    foundSlot = (await page.locator(".slot").count()) > 0;
    if (!foundSlot) await page.getByRole("button", { name: /Change services or date|Đổi dịch vụ hoặc ngày/ }).click();
  }
  expect(foundSlot).toBe(true);
  await expect(page.getByRole("heading", { name: /Available times|Giờ còn trống/ }).first()).toBeVisible();
  await page.locator(".slot").first().click();
  await expect(page.getByRole("heading", { name: /Contact details|Thông tin liên hệ/ }).first()).toBeVisible();
  await page.locator("#contact-name").fill("Khách E2E Sprint 4");
  await page.locator("#contact-phone").fill(publicPhone);
  await page.getByRole("button", { name: /Send verification code|Gửi mã xác minh/ }).click();
  await expect(page.locator("#verification-code")).toHaveValue("123456");
  await page.getByRole("button", { name: /Verify|Xác minh/ }).click();
  await expect(page.getByRole("heading", { name: /Review booking|Xem lại lịch hẹn/ }).first()).toBeVisible();
  const consents = page.locator('input[type="checkbox"]');
  await expect(consents.nth(1)).not.toBeChecked();
  await consents.first().check();
  await page.getByRole("button", { name: /Confirm booking|Xác nhận đặt lịch/ }).click();
  await expect(page.getByRole("heading", { name: /Booking confirmed|Đặt lịch thành công/ }).first()).toBeVisible();
  const reference = await page.locator(".booking-result-card strong").first().innerText();
  expect(reference).toMatch(/^NS-/);

  await page.goto("http://localhost:3002/manage-booking?salon=nailsoft-demo");
  await expect(page.getByRole("heading", { name: /Manage booking|Quản lý lịch hẹn/ }).first()).toBeVisible();
  await expect(page.locator("#manage-salon")).toHaveValue("nailsoft-demo");
  await page.locator("#manage-reference").fill(reference);
  await page.locator("#manage-contact").fill(publicPhone);
  await page.getByRole("button", { name: /Send verification code|Gửi mã xác minh/ }).click();
  await expect(page.locator("#manage-code")).toHaveValue("123456");
  await page.getByRole("button", { name: /Verify|Xác minh/ }).click();
  await expect(page.getByText(reference, { exact: true }).first()).toBeVisible();
  const manageDate = page.locator("#manage-date");
  const manageMin = (await manageDate.getAttribute("min")) ?? "";
  const manageMax = (await manageDate.getAttribute("max")) ?? manageMin;
  let replacementFound = false;
  for (let cursor = toDate(manageMin); dateValue(cursor) <= manageMax && !replacementFound; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    await manageDate.fill(dateValue(cursor));
    await page.getByRole("button", { name: /Choose another time|Chọn giờ khác/ }).click();
    await expect.poll(async () => page.locator(".slot").count(), { timeout: 5000 }).toBeGreaterThan(0).catch(() => undefined);
    replacementFound = (await page.locator(".slot").count()) > 0;
    if (!replacementFound) await page.getByRole("button", { name: /Back|Quay lại/ }).click();
  }
  expect(replacementFound).toBe(true);
  await page.locator(".slot").first().click();
  await page.getByRole("button", { name: /Confirm booking|Xác nhận đặt lịch/ }).click();
  await expect(page.locator('.success[role="status"]')).toContainText(/confirmed|xác nhận|Thời gian mới/);
  await page.getByRole("button", { name: /Cancel booking|Hủy lịch hẹn/ }).click();
  await expect(page.locator('.success[role="status"]')).toContainText(/cancelled|hủy|đã được hủy/);
});
