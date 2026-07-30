import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("Sprint 13 Owner Mobile capability smoke",()=>{
  const screen=readFileSync("apps/owner-mobile/app/[screen].tsx","utf8"),home=readFileSync("apps/owner-mobile/app/index.tsx","utf8");
  it("uses real tenant billing and support APIs",()=>{
    expect(screen).toContain("/v1/tenant/billing/subscription");
    expect(screen).toContain("/v1/tenant/billing/entitlements");
    expect(screen).toContain("/v1/tenant/billing/invoices");
    expect(screen).toContain("/v1/tenant/support-access-grants");
  });
  it("exposes plan quota invoice warning and support routes",()=>{
    for(const route of ["billingPlan","billingQuotas","billingInvoices","billingWarnings","supportAccess"])expect(home).toContain(route);
  });
  it("blocks offline support decisions",()=>expect(screen).toContain("Support decisions are not queued"));
});
