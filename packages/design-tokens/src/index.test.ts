import { describe, expect, it } from "vitest";
import { cssVariables, tokens } from "./index.js";

describe("Sprint 19 design tokens", () => {
  it("exposes semantic navy light-theme roles without a dark theme baseline", () => {
    expect(tokens.theme.mode).toBe("light");
    expect(tokens.color.actionPrimary).toBe("#163A5F");
    expect(tokens.color.accent).toBe("#0F766E");
    expect(tokens.color.chart).toHaveLength(6);
  });
  it("exports CSS variables for every scalar colour token", () => {
    expect(Object.fromEntries(cssVariables)).toMatchObject({
      "--ns-color-action-primary": "#163A5F",
      "--ns-color-text-primary": "#13202B",
      "--ns-color-focus": "#2563EB",
    });
  });
});
