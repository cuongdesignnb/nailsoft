import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const customer = "60000000-0000-4000-8000-000000000001";
const draftCustomer = "60000000-0000-4000-8000-000000000008";
const draftOrder = "a4000000-0000-4000-8000-000000000001";
const draftLine = "a5000000-0000-4000-8000-000000000001";
const draftService = "50000000-0000-4000-8000-000000000008";

test("owner sees the real customer wallet without voucher plaintext", async () => {
  const owner = await login("owner@example.test");
  try {
    const [loyalty, membership, vouchers, packages] = await Promise.all([
      owner.api.get(`/v1/customers/${customer}/loyalty`, {
        headers: headers(owner),
      }),
      owner.api.get(`/v1/customers/${customer}/membership`, {
        headers: headers(owner),
      }),
      owner.api.get(`/v1/customers/${customer}/vouchers`, {
        headers: headers(owner),
      }),
      owner.api.get(`/v1/customers/${customer}/packages`, {
        headers: headers(owner),
      }),
    ]);
    expect(loyalty.status()).toBe(200);
    expect(Number((await loyalty.json()).data.availablePoints)).toBeGreaterThan(
      0,
    );
    expect(membership.status()).toBe(200);
    expect(packages.status()).toBe(200);
    const voucherText = JSON.stringify(await vouchers.json());
    expect(voucherText).toContain("ME10");
    expect(voucherText).not.toContain("WELCOME10");
    expect(voucherText).not.toContain("code_hash");
  } finally {
    await close(owner);
  }
});

test("loyalty adjustment enforces dual control and records one decision", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const created = await owner.api.post("/v1/loyalty-adjustments", {
      headers: headers(owner),
      data: {
        customerId: customer,
        pointsDelta: 7,
        reasonCode: "E2E_SERVICE_RECOVERY",
        note: "Authenticated Sprint 8 dual-control evidence",
      },
    });
    expect(created.status()).toBe(201);
    const row = (await created.json()).data;
    const selfApproval = await owner.api.post(
      `/v1/loyalty-adjustments/${row.id}/approve`,
      {
        headers: headers(owner),
        data: { version: row.version, reason: "Should not self approve" },
      },
    );
    expect(selfApproval.status()).toBe(403);
    expect((await selfApproval.json()).error.code).toBe(
      "LOYALTY_SELF_APPROVAL_DENIED",
    );
    const approved = await manager.api.post(
      `/v1/loyalty-adjustments/${row.id}/approve`,
      {
        headers: headers(manager),
        data: { version: row.version, reason: "Independent manager review" },
      },
    );
    expect(approved.status()).toBe(201);
    expect((await approved.json()).data.status).toBe("APPROVED");
  } finally {
    await close(owner);
    await close(manager);
  }
});

test("POS package reservation is applied once, reprices, and releases safely", async () => {
  const owner = await login("owner@example.test");
  try {
    const created = await owner.api.post("/v1/service-packages", {
      headers: headers(owner, "e2e-s8-package-create"),
      data: {
        code: "E2E-POS-PACKAGE",
        name: { "en-US": "E2E POS Package" },
        description: {},
        grantedUnits: 2,
        unitsPerRedemption: 1,
        priceMinor: 180000,
        currency: "VND",
        validityDays: 30,
        refundPolicy: "RESTORE_UNIT",
        policy: { fixture: "sprint8-e2e" },
        eligibility: [{ serviceId: draftService, unitsPerRedemption: 1 }],
      },
    });
    expect(created.status()).toBe(201);
    const product = (await created.json()).data;
    const activated = await owner.api.post(
      `/v1/service-packages/${product.id}/activate`,
      {
        headers: headers(owner, "e2e-s8-package-activate"),
        data: { version: product.version, reason: "E2E activation" },
      },
    );
    expect(activated.status()).toBe(201);
    const issued = await owner.api.post(
      `/v1/customers/${draftCustomer}/packages/issue`,
      {
        headers: headers(owner, "e2e-s8-package-issue"),
        data: {
          packageProductId: product.id,
          generationKey: "e2e-sprint8-package-issue",
        },
      },
    );
    expect(issued.status()).toBe(201);
    const entitlement = (await issued.json()).data;
    const orderResponse = await owner.api.get(`/v1/pos-orders/${draftOrder}`, {
      headers: headers(owner),
    });
    const order = (await orderResponse.json()).data;
    const idempotencyKey = "e2e-s8-package-apply";
    const request = {
      headers: headers(owner, idempotencyKey),
      data: {
        version: order.version,
        entitlementId: entitlement.id,
        orderLineId: draftLine,
        units: 1,
      },
    };
    const applied = await owner.api.post(
      `/v1/pos-orders/${draftOrder}/benefits/package`,
      request,
    );
    expect(applied.status()).toBe(201);
    const appliedOrder = (await applied.json()).data;
    expect(appliedOrder.totalMinor).toBe(0);
    const replay = await owner.api.post(
      `/v1/pos-orders/${draftOrder}/benefits/package`,
      request,
    );
    expect(replay.status()).toBe(201);
    expect((await replay.json()).data.version).toBe(appliedOrder.version);
    const applications = await owner.api.get(
      `/v1/pos-orders/${draftOrder}/benefits`,
      { headers: headers(owner) },
    );
    const application = (await applications.json()).data.find(
      (item: { benefitType: string }) => item.benefitType === "PACKAGE",
    );
    expect(application).toBeTruthy();
    const released = await owner.api.post(
      `/v1/pos-orders/${draftOrder}/benefits/${application.id}/release`,
      {
        headers: headers(owner, "e2e-s8-package-release"),
        data: { version: appliedOrder.version },
      },
    );
    expect(released.status()).toBe(201);
    expect((await released.json()).data.totalMinor).toBe(110000);
  } finally {
    await close(owner);
  }
});

test("platform super admin is denied salon benefit data", async () => {
  const platform = await login("platform-e2e@example.test");
  try {
    const response = await platform.api.get("/v1/benefits/reports/liability", {
      headers: headers(platform),
    });
    expect([403, 404]).toContain(response.status());
  } finally {
    await close(platform);
  }
});
