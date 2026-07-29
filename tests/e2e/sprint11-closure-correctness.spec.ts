import { expect, test } from "@playwright/test";
import { signPublicToken } from "../../apps/api/src/modules/engagement/engagement-domain";
import { close, headers, login } from "./helpers/api-client";

test("Branch Manager cannot create or read tenant-wide marketing objects", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const global = await owner.api.post("/v1/customer-segments", {
      headers: headers(owner, "s11-closure-owner-global"),
      data: { name: "Closure Owner Global", filters: { marketingConsent: true } },
    });
    expect(global.status()).toBe(201);
    const globalId = (await global.json()).data.id;

    const denied = await manager.api.post("/v1/customer-segments", {
      headers: headers(manager, "s11-closure-manager-global"),
      data: { name: "Closure Manager Global", filters: { marketingConsent: true } },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("TENANT_WIDE_MARKETING_OWNER_ONLY");

    const managerList = await manager.api.get("/v1/customer-segments", { headers: headers(manager) });
    expect(managerList.status()).toBe(200);
    expect((await managerList.json()).data.map((x: { id: string }) => x.id)).not.toContain(globalId);
  } finally {
    await close(owner);
    await close(manager);
  }
});

test("Customer Credit recovery compensation blocks resolve until owning-domain posting", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  const caseId = "e5000000-0000-4000-8000-000000000001";
  try {
    const triaged = await manager.api.post(`/v1/service-recovery/cases/${caseId}/triage`, {
      headers: headers(manager, "s11-closure-triage"),
      data: { version: 1, reason: "Closure triage" },
    });
    expect(triaged.status()).toBe(201);
    const started = await manager.api.post(`/v1/service-recovery/cases/${caseId}/start`, {
      headers: headers(manager, "s11-closure-start"),
      data: { version: 2, reason: "Closure start" },
    });
    expect(started.status()).toBe(201);

    const requested = await manager.api.post(`/v1/service-recovery/cases/${caseId}/compensations`, {
      headers: headers(manager, "s11-closure-credit-request"),
      data: { compensationType: "CUSTOMER_CREDIT", proposal: { amountMinor: "5000", currency: "VND" }, reason: "Closure recovery credit" },
    });
    expect(requested.status()).toBe(201);
    const compensation = (await requested.json()).data;
    const approved = await owner.api.post(`/v1/service-recovery/compensations/${compensation.id}/approve`, {
      headers: headers(owner, "s11-closure-credit-approve"),
      data: { version: compensation.version, reason: "Independent recovery approval" },
    });
    expect(approved.status()).toBe(201);
    const approval = (await approved.json()).data;
    expect(approval.status).toBe("APPROVED");
    expect(approval.existingDomainReference.id).toBeTruthy();

    const blocked = await manager.api.post(`/v1/service-recovery/cases/${caseId}/resolve`, {
      headers: headers(manager, "s11-closure-resolve-blocked"),
      data: { version: 3, resolution: "Must wait for ledger" },
    });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error.code).toBe("RECOVERY_COMPENSATION_NOT_POSTED");

    const posted = await manager.api.post(`/v1/stored-value-adjustments/${approval.existingDomainReference.id}/approve`, {
      headers: headers(manager, "s11-closure-owning-credit-approve"),
      data: { version: 1, reason: "Independent owning-domain approval" },
    });
    expect(posted.status()).toBe(201);
    const detail = await manager.api.get(`/v1/service-recovery/cases/${caseId}`, { headers: headers(manager) });
    const synced = (await detail.json()).data.compensations.find((x: { id: string }) => x.id === compensation.id);
    expect(synced.status).toBe("POSTED");
    expect(synced.sync_status).toBe("POSTED");

    const resolved = await manager.api.post(`/v1/service-recovery/cases/${caseId}/resolve`, {
      headers: headers(manager, "s11-closure-resolve-posted"),
      data: { version: 3, resolution: "Recovery completed after posted credit" },
    });
    expect(resolved.status()).toBe(201);
    expect((await resolved.json()).data.status).toBe("RESOLVED");
  } finally {
    await close(owner);
    await close(manager);
  }
});

test("public unsubscribe needs no Idempotency-Key and duplicate clicks are generic success", async () => {
  const customerId = "60000000-0000-4000-8000-000000000001";
  const tenantId = "10000000-0000-4000-8000-000000000001";
  const secret = process.env.COMMUNICATION_TOKEN_SECRET ?? process.env.JWT_SECRET ?? "development-only-communication-secret";
  const token = signPublicToken(
    { tenantId, customerId, purpose: "MARKETING_EMAIL", exp: Math.floor(Date.now() / 1000) + 3600 },
    secret,
  );
  const owner = await login("owner@example.test");
  try {
    for (let click = 0; click < 2; click += 1) {
      const response = await owner.api.post("/v1/public/communications/unsubscribe", { data: { token } });
      expect(response.status()).toBe(201);
      expect((await response.json()).data).toEqual({ accepted: true });
    }
    const consents = await owner.api.get(`/v1/customers/${customerId}/consents`, { headers: headers(owner) });
    const marketing = (await consents.json()).data.find((x: { purpose: string }) => x.purpose === "MARKETING_EMAIL");
    expect(marketing.state).toBe("WITHDRAWN");
  } finally {
    await close(owner);
  }
});

test("Loyalty and Voucher recovery compensations reach POSTED through owning domains", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  const branchId = "20000000-0000-4000-8000-000000000001";
  const customerId = "60000000-0000-4000-8000-000000000015";
  try {
    for (const kind of ["LOYALTY_POINTS", "VOUCHER"] as const) {
      const suffix = kind === "LOYALTY_POINTS" ? "loyalty" : "voucher";
      const created = await manager.api.post("/v1/service-recovery/cases", {
        headers: headers(manager, `s11-closure-${suffix}-case`),
        data: {
          branchId,
          customerId,
          source: "MANUAL",
          severity: "MEDIUM",
          category: "CUSTOMER_EXPERIENCE",
          summary: `Closure ${suffix} compensation case`,
        },
      });
      expect(created.status()).toBe(201);
      const recovery = (await created.json()).data;
      await manager.api.post(`/v1/service-recovery/cases/${recovery.id}/triage`, {
        headers: headers(manager, `s11-closure-${suffix}-triage`),
        data: { version: 1, reason: "Closure triage" },
      });
      await manager.api.post(`/v1/service-recovery/cases/${recovery.id}/start`, {
        headers: headers(manager, `s11-closure-${suffix}-start`),
        data: { version: 2, reason: "Closure start" },
      });
      const proposal =
        kind === "LOYALTY_POINTS"
          ? { pointsDelta: 25 }
          : {
              campaignId: "c8000000-0000-4000-8000-000000000001",
              code: "CLOSURE-VOUCHER-2026",
              useLimit: 1,
            };
      const requested = await manager.api.post(`/v1/service-recovery/cases/${recovery.id}/compensations`, {
        headers: headers(manager, `s11-closure-${suffix}-request`),
        data: { compensationType: kind, proposal, reason: `Closure ${suffix} recovery` },
      });
      expect(requested.status()).toBe(201);
      const compensation = (await requested.json()).data;
      const approved = await owner.api.post(`/v1/service-recovery/compensations/${compensation.id}/approve`, {
        headers: headers(owner, `s11-closure-${suffix}-approve`),
        data: { version: compensation.version, reason: "Independent recovery approval" },
      });
      expect(approved.status()).toBe(201);
      const result = (await approved.json()).data;
      if (kind === "LOYALTY_POINTS") {
        expect(result.status).toBe("APPROVED");
        const owning = await manager.api.post(`/v1/loyalty-adjustments/${result.existingDomainReference.id}/approve`, {
          headers: headers(manager, "s11-closure-owning-loyalty-approve"),
          data: { version: 1, reason: "Independent loyalty approval" },
        });
        expect(owning.status()).toBe(201);
      } else {
        expect(result.status).toBe("POSTED");
      }
      const detail = await manager.api.get(`/v1/service-recovery/cases/${recovery.id}`, { headers: headers(manager) });
      const synced = (await detail.json()).data.compensations.find((x: { id: string }) => x.id === compensation.id);
      expect(synced.status).toBe("POSTED");
      const resolved = await manager.api.post(`/v1/service-recovery/cases/${recovery.id}/resolve`, {
        headers: headers(manager, `s11-closure-${suffix}-resolve`),
        data: { version: 3, resolution: `Closure ${suffix} resolved after posting` },
      });
      expect(resolved.status()).toBe(201);
    }
  } finally {
    await close(owner);
    await close(manager);
  }
});
