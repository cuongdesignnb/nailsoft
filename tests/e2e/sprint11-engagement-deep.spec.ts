import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("campaign dual control and branch-scoped recovery commands use authenticated APIs", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const campaigns = await owner.api.get("/v1/marketing-campaigns", {
      headers: headers(owner),
    });
    expect(campaigns.status()).toBe(200);
    const campaign = (await campaigns.json()).data.find(
      (item: { id: string }) =>
        item.id === "e9100000-0000-4000-8000-000000000001",
    );
    expect(campaign.status).toBe("PENDING_APPROVAL");
    const approved = await owner.api.post(
      `/v1/marketing-campaigns/${campaign.id}/approve`,
      {
        headers: headers(owner, "s11-campaign-approve"),
        data: { version: campaign.version, reason: "Independent E2E review" },
      },
    );
    expect(approved.status()).toBe(201);
    expect((await approved.json()).data.status).toBe("APPROVED");

    const recovery = await manager.api.post(
      "/v1/service-recovery/cases/e5000000-0000-4000-8000-000000000001/triage",
      {
        headers: headers(manager, "s11-recovery-triage"),
        data: { version: 1, reason: "Authenticated branch triage" },
      },
    );
    expect(recovery.status()).toBe(201);
    expect((await recovery.json()).data.status).toBe("TRIAGED");
  } finally {
    await close(owner);
    await close(manager);
  }
});

test("Platform Super Admin is denied salon engagement data", async () => {
  const platform = await login("platform-e2e@example.test", true);
  try {
    const response = await platform.api.get("/v1/marketing-campaigns", {
      headers: headers(platform),
    });
    expect(response.status()).toBe(403);
  } finally {
    await close(platform);
  }
});

test("Owner compensation approval and Staff assigned tasks use scoped mobile APIs", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  const technician = await login("staff5@example.test");
  try {
    const requested = await manager.api.post(
      "/v1/service-recovery/cases/e5000000-0000-4000-8000-000000000001/compensations",
      {
        headers: headers(manager, "s11-compensation-request"),
        data: {
          compensationType: "NO_MONETARY_COMPENSATION",
          proposal: {},
          reason: "Documented non-monetary recovery action",
        },
      },
    );
    expect(requested.status()).toBe(201);
    const compensation = (await requested.json()).data;

    const pending = await owner.api.get("/v1/service-recovery/compensations", {
      headers: headers(owner),
    });
    expect(pending.status()).toBe(200);
    expect(
      (await pending.json()).data.map((item: { id: string }) => item.id),
    ).toContain(compensation.id);

    const staleApproval = await owner.api.post(
      `/v1/service-recovery/compensations/${compensation.id}/approve`,
      {
        headers: headers(owner, "s11-compensation-stale-approve"),
        data: {
          version: compensation.version + 1,
          reason: "Stale mobile decision must fail",
        },
      },
    );
    expect(staleApproval.status()).toBe(409);
    expect((await staleApproval.json()).error.code).toBe(
      "RECOVERY_COMPENSATION_VERSION_CONFLICT",
    );

    const approved = await owner.api.post(
      `/v1/service-recovery/compensations/${compensation.id}/approve`,
      {
        headers: headers(owner, "s11-compensation-approve"),
        data: {
          version: compensation.version,
          reason: "Independently approved in authenticated E2E",
        },
      },
    );
    expect(approved.status()).toBe(201);
    expect((await approved.json()).data.existingDomainReference.type).toBe(
      "NO_MONETARY_COMPENSATION",
    );

    const tasks = await technician.api.get("/v1/service-recovery/tasks/me", {
      headers: headers(technician),
    });
    expect(tasks.status()).toBe(200);
    expect((await tasks.json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "e5100000-0000-4000-8000-000000000001",
          caseId: "e5000000-0000-4000-8000-000000000001",
        }),
      ]),
    );
  } finally {
    await close(owner);
    await close(manager);
    await close(technician);
  }
});
