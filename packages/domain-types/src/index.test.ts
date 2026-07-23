import { describe, expect, it } from "vitest";
import { currencyMinorUnit } from "./index";

describe("currency minor units", () => {
  it("keeps zero-decimal currencies in their declared units", () => {
    expect(currencyMinorUnit("VND")).toBe(0);
    expect(currencyMinorUnit("JPY")).toBe(0);
    expect(currencyMinorUnit("KRW")).toBe(0);
  });

  it("uses two decimals for the supported default", () => {
    expect(currencyMinorUnit("USD")).toBe(2);
    expect(currencyMinorUnit("eur")).toBe(2);
  });
});
