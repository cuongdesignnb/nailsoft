import { describe, expect, it } from "vitest";
import { creditNoteDirectoryQuerySchema } from "./index";

describe("creditNoteDirectoryQuerySchema", () => {
  it("coerces paging and defaults to newest", () => {
    expect(
      creditNoteDirectoryQuerySchema.parse({ page: "2", pageSize: "50" }),
    ).toMatchObject({ page: 2, pageSize: 50, sort: "NEWEST" });
  });

  it("keeps only real Credit Note lifecycle and refund-kind values", () => {
    expect(
      creditNoteDirectoryQuerySchema.parse({ status: "ISSUED", refundKind: "PARTIAL" }),
    ).toMatchObject({ status: "ISSUED", refundKind: "PARTIAL" });
    expect(creditNoteDirectoryQuerySchema.safeParse({ status: "APPLIED" }).success).toBe(false);
    expect(creditNoteDirectoryQuerySchema.safeParse({ refundKind: "UNKNOWN" }).success).toBe(false);
  });

  it("rejects reversed dates, unsupported page sizes, and unknown fields", () => {
    expect(creditNoteDirectoryQuerySchema.safeParse({ pageSize: "15" }).success).toBe(false);
    expect(
      creditNoteDirectoryQuerySchema.safeParse({ issuedFrom: "2026-08-15", issuedTo: "2026-08-01" }).success,
    ).toBe(false);
    expect(creditNoteDirectoryQuerySchema.safeParse({ deliveryStatus: "SENT" }).success).toBe(false);
  });
});
