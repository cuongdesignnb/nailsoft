import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("legacy tenant keeps full zero-price access while platform and tenant roles remain separated", async () => {
  const owner = await login("owner@example.test");
  const platform = await login("platform-e2e@example.test");

  try {
    const subscriptionResponse = await owner.api.get(
      "/v1/tenant/billing/subscription",
      {
        headers: headers(owner),
      },
    );
    expect(subscriptionResponse.ok()).toBeTruthy();
    const subscription = (await subscriptionResponse.json()).data;
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.collectionMode).toBe("DISABLED");

    const entitlementResponse = await owner.api.get(
      "/v1/tenant/billing/entitlements",
      {
        headers: headers(owner),
      },
    );
    expect(entitlementResponse.ok()).toBeTruthy();
    const entitlements = (await entitlementResponse.json()).data;
    expect(entitlements.length).toBeGreaterThanOrEqual(20);
    expect(
      entitlements.every(
        (item: { enabled: boolean | null; unlimited: boolean }) =>
          item.enabled === true || item.unlimited,
      ),
    ).toBeTruthy();

    const ownerPlatformResponse = await owner.api.get("/v1/platform/plans", {
      headers: headers(owner),
    });
    expect(ownerPlatformResponse.status()).toBe(403);

    const platformPlansResponse = await platform.api.get("/v1/platform/plans", {
      headers: headers(platform),
    });
    expect(platformPlansResponse.ok()).toBeTruthy();

    const platformSalonResponse = await platform.api.get("/v1/appointments", {
      headers: headers(platform),
    });
    expect(platformSalonResponse.status()).toBe(403);
  } finally {
    await close(owner);
    await close(platform);
  }
});

test("tenant Owner starts trial and immediately changes plan through idempotent commands", async () => {
  const owner = await login("owner@example.test");

  try {
    const trialResponse = await owner.api.post(
      "/v1/tenant/billing/subscription/start-trial",
      {
        headers: headers(owner, "sprint13-e2e-start-trial"),
        data: {
          planId: "13000000-0000-4000-8000-000000000011",
          trialDays: 14,
          collectionMode: "MANUAL_INVOICE",
        },
      },
    );
    expect(trialResponse.ok()).toBeTruthy();
    const trial = (await trialResponse.json()).data;
    expect(trial.status).toBe("TRIALING");

    const changeResponse = await owner.api.post(
      "/v1/tenant/billing/subscription/change-plan",
      {
        headers: headers(owner, "sprint13-e2e-change-plan"),
        data: {
          planId: "13000000-0000-4000-8000-000000000012",
          effectiveMode: "IMMEDIATE",
          version: trial.version,
        },
      },
    );
    expect(changeResponse.ok()).toBeTruthy();
    const changed = (await changeResponse.json()).data;
    expect(changed.status).toBe("APPLIED");
    expect(BigInt(changed.prorationMinor)).toBeGreaterThan(0n);

    const activeResponse = await owner.api.get(
      "/v1/tenant/billing/subscription",
      {
        headers: headers(owner),
      },
    );
    expect(activeResponse.ok()).toBeTruthy();
    expect((await activeResponse.json()).data.status).toBe("ACTIVE");

    const replayResponse = await owner.api.post(
      "/v1/tenant/billing/subscription/change-plan",
      {
        headers: headers(owner, "sprint13-e2e-change-plan"),
        data: {
          planId: "13000000-0000-4000-8000-000000000012",
          effectiveMode: "IMMEDIATE",
          version: trial.version,
        },
      },
    );
    expect(replayResponse.ok()).toBeTruthy();
    expect((await replayResponse.json()).data.idempotencyReplayed).toBeTruthy();
  } finally {
    await close(owner);
  }
});
