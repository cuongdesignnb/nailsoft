import { describe, expect, it } from "vitest";
import {
  paymentReconciliationBulkConfirmSchema,
  paymentReconciliationDecisionSchema,
  paymentReconciliationQuerySchema,
} from "./index";

describe("payment reconciliation contracts", () => {
  it("keeps search, filters and pagination server-owned", () => {
    const result = paymentReconciliationQuerySchema.parse({
      page: "2",
      pageSize: "50",
      tenderType: "CASH",
      caseType: "MISSING_CASH_MOVEMENT",
      reviewState: "UNDER_REVIEW",
      attentionOnly: "true",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-16",
    });

    expect(result).toMatchObject({
      page: 2,
      pageSize: 50,
      tenderType: "CASH",
      caseType: "MISSING_CASH_MOVEMENT",
      reviewState: "UNDER_REVIEW",
      attentionOnly: true,
    });
  });

  it("does not allow payment-status UNKNOWN or client-provided amounts", () => {
    expect(paymentReconciliationQuerySchema.safeParse({ paymentStatus: "UNKNOWN" }).success).toBe(false);
    expect(paymentReconciliationDecisionSchema.safeParse({ version: 1, decision: "CONFIRM_MATCH", confirmedMinor: 1 }).success).toBe(false);
    expect(paymentReconciliationDecisionSchema.safeParse({ version: 1, decision: "ACCEPT_VARIANCE" }).success).toBe(true);
  });

  it("requires a version for safe bulk confirmation", () => {
    expect(paymentReconciliationBulkConfirmSchema.safeParse({ versionByPaymentId: {} }).success).toBe(false);
    expect(paymentReconciliationBulkConfirmSchema.safeParse({ versionByPaymentId: { "a6000000-0000-4000-8000-000000000003": 1 } }).success).toBe(true);
  });
});
