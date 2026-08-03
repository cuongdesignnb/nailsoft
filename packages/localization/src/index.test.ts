import { describe, expect, it } from "vitest";
import { containsMojibake, formatCurrency, formatDuration, locales, messages } from "./index.js";

describe("Sprint 19 localization foundation", () => {
  it("keeps Vietnamese and English message keys in parity", () => {
    expect(Object.keys(messages["vi-VN"]).sort()).toEqual(Object.keys(messages["en-US"]).sort());
    expect(locales).toEqual(["vi-VN", "en-US"]);
  });
  it("does not publish mojibake in shared messages", () => {
    for (const locale of locales) for (const message of Object.values(messages[locale])) expect(containsMojibake(message)).toBe(false);
    expect(containsMojibake("Normal localized text")).toBe(false);
    expect(containsMojibake(String.fromCodePoint(0x00c3, 0x0084, 0x00c2, 0x0090))).toBe(true);
  });
  it("formats financial and duration values without concatenating translated fragments", () => {
    expect(formatCurrency(35000000, "VND", "vi-VN")).toContain("350.000");
    expect(formatDuration(5400, "vi-VN")).toBe(`1 gi${String.fromCodePoint(0x1edd)} 30 ph${String.fromCodePoint(0x00fa)}t`);
  });
});
