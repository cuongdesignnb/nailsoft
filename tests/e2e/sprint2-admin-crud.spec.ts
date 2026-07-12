import { expect, test } from "@playwright/test";

test("Admin Web exposes Sprint 2 CRUD workspaces and safe unauthenticated state", async ({ page }) => {
  const routes: Array<[string, string]> = [
    ["/admin/catalog/categories", "Service categories"],
    ["/admin/catalog/services", "Service catalog"],
    ["/admin/catalog/skills", "Skills"],
    ["/admin/catalog/resource-types", "Resource types"],
    ["/admin/catalog/resources", "Branch resources"],
    ["/admin/staff/list", "Staff profiles"],
    ["/admin/scheduling/shifts", "Shift planner"],
    ["/admin/scheduling/leave-requests", "Leave review"],
  ];
  for (const [route, title] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(/Permission required|Nothing here yet|Unable to load|Loading securely/).first()).toBeVisible();
  }
});

test("service detail exposes General, Pricing, Skills, Resources and Add-ons tabs", async ({ page }) => {
  await page.goto("/admin/catalog/services/50000000-0000-4000-8000-000000000001");
  for (const tab of ["General", "Pricing", "Skills", "Resources", "Add-ons"]) await expect(page.getByRole("tab", { name: new RegExp(tab) })).toBeVisible();
});
