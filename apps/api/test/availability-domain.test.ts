import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { availabilityCacheKey } from "../src/modules/availability/availability-cache.service.js";
import {
  calculationFingerprint,
  intervalsOverlap,
  localTimeCandidates,
  occupancy,
} from "../src/modules/availability/availability-domain.js";
describe("availability domain", () => {
  it("applies prep, cleanup and buffer occupancy semantics", () => {
    const start = DateTime.fromISO("2026-08-10T10:00:00+07:00", {
      setZone: true,
    });
    const x = occupancy(start, {
      duration: 60,
      prep: 10,
      cleanup: 15,
      bufferBefore: 5,
      bufferAfter: 10,
    });
    expect(x.staffStart.toISO()).toContain("09:55");
    expect(x.resourceStart.toISO()).toContain("09:45");
    expect(x.staffEnd.toISO()).toContain("11:25");
    expect(x.serviceEnd.toISO()).toContain("11:00");
  });
  it("uses half-open overlap", () => {
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false);
    expect(intervalsOverlap(0, 10, 9, 20)).toBe(true);
  });
  it("detects New York DST gap and preserves both ambiguous instants", () => {
    const gap = localTimeCandidates("2026-03-08", "02:30", "America/New_York");
    expect(gap.gap).toBe(true);
    const ambiguous = localTimeCandidates(
      "2026-11-01",
      "01:30",
      "America/New_York",
    );
    expect(ambiguous.ambiguous).toBe(true);
    expect(new Set(ambiguous.instants.map((x) => x.toUTC().toISO())).size).toBe(
      2,
    );
  });
  it("produces stable SHA-256 fingerprints", () => {
    const a = calculationFingerprint(["tenant", "slot", 1]);
    expect(a).toHaveLength(64);
    expect(calculationFingerprint(["tenant", "slot", 1])).toBe(a);
    expect(calculationFingerprint(["tenant", "slot", 2])).not.toBe(a);
  });
  it("builds versioned tenant-isolated cache keys", () => {
    const key = availabilityCacheKey(
      "tenant-a",
      {
        branchId: "b",
        serviceId: "s",
        dateFrom: "2026-08-01",
        dateTo: "2026-08-07",
        slotIntervalMin: 15,
      },
      9,
    );
    expect(key).toContain("tenant:tenant-a");
    expect(key).toContain("staff:ANY");
    expect(key).toContain("version:9");
  });
});
