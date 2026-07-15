import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 4 mobile booking surfaces", () => {
  it("Owner Mobile exposes appointment list/detail and guarded commands", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
    ]);
    for (const route of ["appointmentsToday", "appointments", "appointment"])
      expect(`${index}${screen}`).toContain(route);
    expect(screen).toContain("/v1/appointments");
    for (const action of ["confirm", "cancel", "waive-deposit"])
      expect(screen).toContain(action);
    expect(screen).toContain("Version conflict");
    expect(screen).toContain("Internet connection required");
  });

  it("Staff Mobile exposes only assigned appointment reads and no lifecycle writes", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("upcomingAppointments");
    expect(screen).toContain("/v1/appointments");
    expect(screen).toContain("Only your assigned appointments are visible");
    expect(screen).not.toContain("waive-deposit");
    expect(screen).not.toContain("bookingCommand");
  });
});
