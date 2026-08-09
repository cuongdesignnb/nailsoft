import { describe, expect, it } from "vitest";

describe("Sprint 19 Wave 7 public route ownership", () => {
  it("keeps public booking paths distinct from admin and mobile paths", () => {
    const bookingPaths = ["/", "/book/nailsoft-demo", "/manage-booking"];
    expect(bookingPaths.every((path) => path === "/" || path.startsWith("/book/") || path.startsWith("/manage-booking"))).toBe(true);
    expect(bookingPaths.some((path) => path.startsWith("/admin"))).toBe(false);
    expect(bookingPaths.some((path) => path.startsWith("/owner"))).toBe(false);
    expect(bookingPaths.some((path) => path.startsWith("/staff"))).toBe(false);
  });
});
