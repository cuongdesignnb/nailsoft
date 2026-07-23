import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { branchA, technicianAStaff } from "./helpers/test-data";

const serviceId = "50000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";
let createdAppointmentId = "";
let createdShiftId = "";

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
  await page.locator("form button").click();
  await expect(page.getByRole("status")).toBeVisible();
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
          startAt: "2026-08-10T01:30:00.000Z",
          endAt: "2026-08-10T11:00:00.000Z",
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
    await page.goto("http://localhost:3000/admin/appointments/new");
    await expect(
      page.getByRole("heading", { name: "Quick create" }),
    ).toBeVisible();
    await page.locator('select[name="branchId"]').selectOption(branchA);
    await page.locator('select[name="customerId"]').selectOption(customerId);
    await page.locator('select[name="serviceIds"]').selectOption([serviceId]);
    await page
      .getByLabel("Technician for the first service")
      .selectOption(technicianAStaff);
    await page.getByLabel("Date in branch timezone").fill("2026-08-10");
    await page.getByRole("button", { name: "Find availability" }).click();
    await expect(page.locator(".slots button").first()).toBeVisible();
    await page.locator(".slots button").first().click();
    await page.getByRole("button", { name: "Create and confirm" }).click();
    await expect(
      page.getByRole("heading", { name: "Appointment created" }),
    ).toBeVisible();
    const href = await page
      .getByRole("link", { name: "Open appointment" })
      .getAttribute("href");
    createdAppointmentId = href?.split("/")[3] ?? "";
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
    await expect(page.getByLabel("New date")).toBeEnabled();
    await page.getByLabel("New date").fill("2026-08-10");
    await page.getByRole("button", { name: "Hold replacement slot" }).click();
    await expect(
      page.getByRole("button", { name: "Confirm reschedule" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm reschedule" }).click();
    await expect(page.getByRole("status")).toContainText("successfully");
  });

  test("assigned technician sees only the assigned appointment item", async ({
    page,
  }) => {
    await login(page, "staff5@example.test");
    await page.goto(
      `http://localhost:3000/admin/appointments/${createdAppointmentId}/services`,
    );
    await expect(page.locator(".slots article")).toHaveCount(1);
    await expect(page.locator(".slots article")).toContainText("Staff 5");
  });

  test("reception cancels the appointment through the audited command UI", async ({
    page,
  }) => {
    await login(page, "staff3@example.test");
    await page.goto(
      `http://localhost:3000/admin/appointments/${createdAppointmentId}/cancel`,
    );
    await page.getByLabel("Note").fill("Sprint 4 deep E2E cancellation");
    await page.getByRole("button", { name: "Review and cancel" }).click();
    await expect(page.getByRole("status")).toContainText("successfully");
    await page.goto(
      `http://localhost:3000/admin/appointments/${createdAppointmentId}/overview`,
    );
    await expect(
      page.getByRole("heading", { name: "CANCELLED_BY_SALON" }),
    ).toBeVisible();
  });
});

test("authenticated Admin Web exposes appointment operations and live filters", async ({
  page,
}) => {
  await login(page, "staff3@example.test");
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

test("public booking supports real date, multi-service ordering and scoped management", async ({
  page,
}) => {
  const publicPhone = `090${String(Date.now()).slice(-7)}`;
  await page.goto("http://localhost:3002/book/nailsoft-demo");
  await expect(
    page.getByRole("heading", { name: "Chọn dịch vụ của bạn." }),
  ).toBeVisible();
  const branch = page.getByRole("button", { name: /Q1/ });
  await expect(branch).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Quản lý lịch hẹn" }),
  ).toBeVisible();
  await branch.click();

  const choices = page.locator("button.choice");
  await expect(choices.first()).toBeVisible();
  await choices.first().click();
  // SVC-11 is the next catalog item with a resource type available in branch Q1.
  await choices.nth(2).click();
  await expect(page.getByText("Dịch vụ đã chọn")).toBeVisible();
  const date = page.getByLabel(/Ngày hẹn/);
  await expect(date).toHaveAttribute("min", /2026-/);
  await date.fill("2026-08-10");
  await page.getByRole("button", { name: "Tìm giờ trống" }).click();
  await expect(
    page.getByRole("heading", { name: "Giờ còn trống" }),
  ).toBeVisible();
  await page.locator(".slots button.choice").first().click();
  await expect(
    page.getByRole("heading", { name: "Thông tin liên hệ" }),
  ).toBeVisible();
  await page.getByLabel("Họ tên").fill("Khách E2E Sprint 4");
  await page.getByLabel("Số điện thoại").fill(publicPhone);
  await page.getByRole("button", { name: "Gửi mã xác minh" }).click();
  await expect(page.getByLabel("Mã xác minh")).toHaveValue("123456");
  await page.getByRole("button", { name: "Xác minh" }).click();
  await expect(
    page.getByRole("heading", { name: "Xem lại lịch hẹn" }),
  ).toBeVisible();
  const consents = page.locator('input[type="checkbox"]');
  await expect(consents.nth(1)).not.toBeChecked();
  await consents.first().check();
  await page.getByRole("button", { name: "Xác nhận đặt lịch" }).click();
  await expect(
    page.getByRole("heading", { name: "Đặt lịch thành công" }),
  ).toBeVisible();
  const reference = await page.locator(".success strong").first().innerText();
  expect(reference).toMatch(/^NS-/);

  await page.goto("http://localhost:3002/manage-booking?salon=nailsoft-demo");
  await expect(
    page.getByRole("heading", { name: "Quản lý lịch hẹn." }),
  ).toBeVisible();
  await expect(page.getByLabel("Mã salon")).toHaveValue("nailsoft-demo");
  await page.getByLabel("Mã lịch hẹn").fill(reference);
  await page.getByLabel("Số điện thoại hoặc email").fill(publicPhone);
  await page.getByRole("button", { name: "Gửi mã truy cập" }).click();
  await expect(page.getByLabel("Mã xác minh")).toHaveValue("123456");
  await page.getByRole("button", { name: "Mở lịch hẹn" }).click();
  await expect(page.getByRole("heading", { name: reference })).toBeVisible();
  await page.getByLabel("Ngày mới").fill("2026-08-10");
  await page.getByRole("button", { name: "Chọn lịch mới" }).click();
  await expect(
    page.getByRole("heading", { name: "Chọn giờ mới" }),
  ).toBeVisible();
  await page.locator(".slots button.choice").first().click();
  await page.getByRole("button", { name: "Xác nhận đổi lịch" }).click();
  await expect(page.locator('.success[role="status"]')).toContainText(
    "Đổi lịch thành công",
  );
  await page.getByRole("button", { name: "Hủy lịch hẹn" }).click();
  await expect(page.locator('.success[role="status"]')).toContainText(
    "Lịch hẹn đã được hủy",
  );
});
