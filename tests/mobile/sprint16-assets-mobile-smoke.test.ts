import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sprint 16 fixed-assets mobile smoke", () => {
  const owner = readFileSync("apps/owner-mobile/app/[screen].tsx", "utf8");
  const staff = readFileSync("apps/staff-mobile/app/[screen].tsx", "utf8");

  it("exposes owner operational asset screens backed by API calls", () => {
    for (const key of ["assetSummary", "assetApprovals", "assetMaintenance", "assetTransfers", "assetDisposals"]) expect(owner).toContain(key);
    for (const path of ["/v1/assets/reports/net-book-value", "/v1/assets/capitalization-requests", "/v1/assets/reports/maintenance-due", "/v1/assets/transfers", "/v1/assets/disposals"]) expect(owner).toContain(path);
  });

  it("exposes staff maintenance, inspection and transfer screens", () => {
    for (const key of ["assetMaintenance", "assetInspection", "assetTransfer"]) expect(staff).toContain(key);
    for (const path of ["/v1/assets/maintenance-work-orders", "/v1/assets/inspections", "/v1/assets/transfers"]) expect(staff).toContain(path);
  });

  it("keeps loading, empty, retry and permission states", () => {
    expect(owner).toContain("Loading");
    expect(staff).toContain("Loading");
    expect(owner).toContain("No records");
    expect(staff).toContain("Retry");
    expect(owner).toContain("Permission denied");
  });
});
