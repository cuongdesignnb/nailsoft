import { describe, expect, it, vi } from "vitest";
import { FinancialReportingService } from "../src/modules/finance/financial-reporting.service.js";

describe("Sprint 7 financial reporting queries", () => {
  it("qualifies the invoice line key when service revenue joins refund lines", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new FinancialReportingService(
      { query } as never,
      {} as never,
      {} as never,
    );

    await (service as never as {
      netSalesServices: (
        auth: { tenantId: string },
        filters: { serviceId?: string; staffId?: string },
        branchIds: string[],
        from: string,
        to: string,
      ) => Promise<unknown>;
    }).netSalesServices(
      { tenantId: "10000000-0000-4000-8000-000000000001" },
      {},
      ["20000000-0000-4000-8000-000000000001"],
      "2026-07-27",
      "2026-08-25",
    );

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("count(DISTINCT l.invoice_line_id)");
    expect(sql).not.toMatch(/count\(DISTINCT\s+invoice_line_id\)/);
  });
});
