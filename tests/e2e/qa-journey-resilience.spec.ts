import { expect, test, type Page } from "@playwright/test";

const seededCampaignId = "e9100000-0000-4000-8000-000000000001";
const seededCustomerId = "60000000-0000-4000-8000-000000000001";

async function loginUi(page: Page, email = "owner@example.test") {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([
    page.waitForURL("**/admin/dashboard"),
    page.locator("form button").click(),
  ]);
}

test.describe("QA journey resilience — refresh, navigation, tabs and retry", () => {
  test("J34 preserves Marketing filters and selected Campaign across reload, back and a second tab", async ({ page, context }) => {
    await loginUi(page);
    await page.goto(`/admin/marketing/campaigns?search=July&pageSize=20&sort=OLDEST&campaignId=${seededCampaignId}`);
    await expect(page.getByRole("heading", { name: "Marketing khách hàng", exact: true })).toBeVisible();
    await expect(page.getByLabel("Tìm chiến dịch hoặc nhóm khách")).toHaveValue("July");
    await expect(page.getByLabel("Số dòng mỗi trang")).toHaveValue("20");
    await expect(page.getByLabel("Sắp xếp")).toHaveValue("OLDEST");
    await expect(page.getByRole("heading", { name: "Đối tượng chiến dịch", exact: true })).toBeVisible();

    const selectedUrl = new URL(page.url());
    expect(selectedUrl.searchParams.get("search")).toBe("July");
    expect(selectedUrl.searchParams.get("pageSize")).toBe("20");
    expect(selectedUrl.searchParams.get("sort")).toBe("OLDEST");
    expect(selectedUrl.searchParams.get("campaignId")).toBe(seededCampaignId);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Marketing khách hàng", exact: true })).toBeVisible();
    await expect(page.getByLabel("Tìm chiến dịch hoặc nhóm khách")).toHaveValue("July");
    await expect(page.getByLabel("Số dòng mỗi trang")).toHaveValue("20");
    await expect(page.getByLabel("Sắp xếp")).toHaveValue("OLDEST");
    await expect(page.getByRole("heading", { name: "Đối tượng chiến dịch", exact: true })).toBeVisible();

    await page.goto("/admin/customer-care");
    await expect(page.getByRole("heading", { name: "Lịch sử liên hệ & chăm sóc", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Marketing khách hàng", exact: true })).toBeVisible();
    await expect(page.getByLabel("Tìm chiến dịch hoặc nhóm khách")).toHaveValue("July");
    expect(new URL(page.url()).searchParams.get("campaignId")).toBe(seededCampaignId);

    const secondTab = await context.newPage();
    try {
      await secondTab.goto(page.url());
      await expect(secondTab.getByRole("heading", { name: "Marketing khách hàng", exact: true })).toBeVisible();
      await expect(secondTab.getByLabel("Tìm chiến dịch hoặc nhóm khách")).toHaveValue("July");
      await expect(secondTab.getByRole("heading", { name: "Đối tượng chiến dịch", exact: true })).toBeVisible();
      expect(new URL(secondTab.url()).searchParams.get("campaignId")).toBe(seededCampaignId);
      expect(new URL(secondTab.url()).searchParams.get("search")).toBe("July");
      expect(page.url()).toContain("campaignId=");
    } finally {
      await secondTab.close();
    }
  });

  test("J35 retries a failed read and rejects an offline care write without local persistence", async ({ page, context }) => {
    await loginUi(page);
    await page.goto("/admin/customer-care");
    await expect(page.getByRole("heading", { name: "Lịch sử liên hệ & chăm sóc", exact: true })).toBeVisible();

    await page.route("**/v1/customer-care/directory**", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Làm mới" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Không thể tải danh sách" })).toBeVisible();
    await page.unroute("**/v1/customer-care/directory**");
    await page.getByRole("alert").filter({ hasText: "Không thể tải danh sách" }).getByRole("button", { name: "Thử lại" }).click();
    await expect(page.getByRole("heading", { name: "Hoạt động chăm sóc khách hàng", exact: true })).toBeVisible();

    await page.goto(`/admin/customers/${seededCustomerId}/engagement`);
    await expect(page.getByRole("heading", { name: "Lịch sử liên hệ & chăm sóc", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Tạo hoạt động chăm sóc" }).click();
    await expect(page.getByRole("dialog", { name: "Tạo hoạt động chăm sóc" })).toBeVisible();
    await page.getByRole("dialog").locator("textarea").fill("QA offline write must not be queued");
    await context.setOffline(true);
    try {
      await page.getByRole("dialog").getByRole("button", { name: "Lưu hoạt động" }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Internet connection required");
      await expect(page.getByRole("dialog")).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
    await page.getByRole("dialog").getByRole("button", { name: "Hủy" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
