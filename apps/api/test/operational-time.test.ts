import { describe, expect, it } from "vitest";
import {
  branchLocalDate,
  branchLocalDayRange,
  roundUpBranchTime,
} from "../src/modules/operations/operational-time";

describe("Sprint 5 operational timezone", () => {
  it("rounds a non-aligned Ho Chi Minh instant to the next five-minute slot", () => {
    expect(
      roundUpBranchTime(
        "2026-07-27T10:02:31+07:00",
        "Asia/Ho_Chi_Minh",
      ).toISO(),
    ).toBe("2026-07-27T03:05:00.000Z");
  });

  it("creates half-open local-day ranges for Ho Chi Minh", () => {
    expect(branchLocalDayRange("2026-07-27", "Asia/Ho_Chi_Minh")).toEqual({
      startUtc: "2026-07-26T17:00:00.000Z",
      endUtc: "2026-07-27T17:00:00.000Z",
    });
  });

  it("uses 23-hour and 25-hour New York days across DST", () => {
    const spring = branchLocalDayRange("2026-03-08", "America/New_York"),
      fall = branchLocalDayRange("2026-11-01", "America/New_York");
    expect(
      (Date.parse(spring.endUtc) - Date.parse(spring.startUtc)) / 3_600_000,
    ).toBe(23);
    expect(
      (Date.parse(fall.endUtc) - Date.parse(fall.startUtc)) / 3_600_000,
    ).toBe(25);
  });

  it("keeps boundary instants on the correct local board day", () => {
    expect(branchLocalDate("2026-07-26T18:00:00Z", "Asia/Ho_Chi_Minh")).toBe(
      "2026-07-27",
    );
    expect(branchLocalDate("2026-07-27T16:30:00Z", "Asia/Ho_Chi_Minh")).toBe(
      "2026-07-27",
    );
  });
});
