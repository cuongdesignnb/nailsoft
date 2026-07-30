import { describe, expect, it } from "vitest";
import {
  accessModeAllowsWrite,
  canTransitionSubscription,
  entitlementAllows,
  fingerprint,
  prorateMinor,
  refundableMinor,
  stablePlatformPaymentKey,
} from "../src/modules/platform-billing/platform-billing-domain.js";

describe("Sprint 13 platform billing domain",()=>{
  it("uses explicit subscription transitions",()=>{
    expect(canTransitionSubscription("TRIALING","ACTIVE")).toBe(true);
    expect(canTransitionSubscription("ACTIVE","TERMINATED")).toBe(false);
    expect(canTransitionSubscription("TERMINATED","ACTIVE")).toBe(false);
  });
  it("prorates signed bigint values with half-up rounding and no float",()=>{
    expect(prorateMinor(10001n,5n,10n)).toBe(5001n);
    expect(prorateMinor(-10001n,5n,10n)).toBe(-5001n);
    expect(()=>prorateMinor(1n,11n,10n)).toThrow("INVALID_PRORATION_PERIOD");
  });
  it("keeps payment key stable and fingerprints deterministic",()=>{
    expect(stablePlatformPaymentKey("t","i","p")).toBe("platform-payment:t:i:p");
    expect(fingerprint({b:2,a:1})).toBe(fingerprint({a:1,b:2}));
  });
  it("resolves override first and fails closed without a source",()=>{
    const plan={enabled:true,quotaLimit:null,unlimited:false};
    const override={enabled:false,quotaLimit:null,unlimited:false};
    expect(entitlementAllows({plan,override})).toBe(override);
    expect(entitlementAllows({})).toBeNull();
  });
  it("allows billing but blocks salon writes in restricted modes",()=>{
    expect(accessModeAllowsWrite("READ_ONLY","SALON")).toBe(false);
    expect(accessModeAllowsWrite("SUSPENDED","BILLING")).toBe(true);
    expect(accessModeAllowsWrite("TERMINATED","EXPORT")).toBe(false);
    expect(refundableMinor(100n,40n)).toBe(60n);
  });
});
