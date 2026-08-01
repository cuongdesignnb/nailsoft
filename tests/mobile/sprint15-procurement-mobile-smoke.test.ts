import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sprint 15 Owner Mobile procurement smoke", () => {
  const screen = readFileSync("apps/owner-mobile/app/[screen].tsx", "utf8");
  const home = readFileSync("apps/owner-mobile/app/index.tsx", "utf8");
  it("exposes procurement read screens backed by API client calls", () => {
    for (const key of ["procurementVendors", "procurementRequests", "procurementOrders", "procurementBills", "procurementAp", "procurementPayments"]) expect(home).toContain(key);
    for (const path of ["/v1/procurement/vendors", "/v1/procurement/purchase-requests", "/v1/procurement/purchase-orders", "/v1/procurement/vendor-bills", "/v1/procurement/ap/open-items", "/v1/procurement/vendor-payments"]) expect(screen).toContain(path);
  });
  it("shows loading, empty and error states", () => { expect(screen).toContain("Loading"); expect(screen).toContain("No records"); expect(screen).toContain("Retry"); });
});
