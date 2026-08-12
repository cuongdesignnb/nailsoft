import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  accountingReconciliationAdjustmentCreateSchema,
  accountingStatementLineExcludeSchema,
  accountingStatementLineRestoreSchema,
} from "../../packages/validation/src/index.js";

const routes = [
  "/accounting/bank-accounts/{bankAccountId}/statement-lines/{statementLineId}/exclude",
  "/accounting/bank-accounts/{bankAccountId}/statement-lines/{statementLineId}/restore",
  "/accounting/bank-reconciliations/{reconciliationId}/adjustments",
  "/accounting/reconciliation-adjustments/{id}/submit",
  "/accounting/reconciliation-adjustments/{id}/approve",
  "/accounting/reconciliation-adjustments/{id}/reject",
  "/accounting/reconciliation-adjustments/{id}/cancel",
  "/accounting/reconciliation-adjustments/{id}/post",
];

describe("Sprint 20 Wave 2 accounting reconciliation contract", () => {
  it("keeps the eight approved command routes and existing permissions", async () => {
    const openapi = await readFile("docs/api/openapi.yaml", "utf8");
    for (const route of routes) {
      const start = openapi.indexOf(`  ${route}:`);
      expect(start, route).toBeGreaterThanOrEqual(0);
      expect(openapi.slice(start, start + 2600)).toContain("post:");
      expect(openapi.slice(start, start + 2600)).toContain("IdempotencyKey");
    }
    expect(openapi).toContain("accounting.bank_reconciliation.manage");
    expect(openapi).toContain("accounting.journal.post");
    expect(openapi).not.toContain("accounting.reconciliation.adjustment.manage");
  });

  it("keeps strict minor-unit and optimistic-concurrency schemas", () => {
    expect(() => accountingStatementLineExcludeSchema.parse({ version: 1, expectedMatchState: "UNMATCHED", reason: "valid reason", extra: true })).toThrow();
    expect(() => accountingStatementLineRestoreSchema.parse({ version: 1, reason: "valid reason", periodId: "00000000-0000-0000-0000-000000000001" })).toThrow();
    expect(() => accountingReconciliationAdjustmentCreateSchema.parse({ amountMinor: "0", direction: "DEBIT", offsetAccountId: "00000000-0000-0000-0000-000000000001", accountingDate: "2026-06-15", reason: "invalid amount" })).toThrow();
    expect(accountingReconciliationAdjustmentCreateSchema.parse({ amountMinor: "5000", direction: "CREDIT", offsetAccountId: "00000000-0000-0000-0000-000000000001", accountingDate: "2026-06-15", reason: "valid reason" })).toMatchObject({ amountMinor: "5000", direction: "CREDIT" });
  });

  it("contains migration safety guards for versions, history and posted immutability", async () => {
    const migration = await readFile("infra/migrations/0036_accounting_reconciliation_closure.up.sql", "utf8");
    expect(migration).toContain("accounting_bank_statement_lines");
    expect(migration).toContain("version integer NOT NULL DEFAULT 1");
    expect(migration).toContain("accounting_reconciliation_adjustment_history");
    expect(migration).toContain("ACCOUNTING_RECONCILIATION_ADJUSTMENT_IMMUTABLE");
    expect(migration).toContain("0036_accounting_reconciliation_closure");
  });
});
