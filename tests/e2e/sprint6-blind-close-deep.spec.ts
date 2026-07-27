import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const session = "a3000000-0000-4000-8000-000000000001";

test("cashier blind declaration, manager review and final reveal", async () => {
  const cashier = await login("cashier@example.test");
  const manager = await login("staff2@example.test");
  try {
    const openResponse = await cashier.api.get(`/v1/cash-sessions/${session}`, {
      headers: headers(cashier),
    });
    expect(openResponse.status()).toBe(200);
    const open = (await openResponse.json()).data;
    expect(open.expectedCashMinor).toBeNull();
    expect(open.varianceMinor).toBeNull();

    const beginResponse = await cashier.api.post(
      `/v1/cash-sessions/${session}/begin-closing`,
      { headers: headers(cashier), data: { version: open.version } },
    );
    expect(beginResponse.status()).toBe(201);
    const beginning = (await beginResponse.json()).data;
    expect(beginning.expectedCashMinor).toBeNull();

    const reviewResponse = await manager.api.get(
      `/v1/cash-sessions/${session}/closing-review`,
      { headers: headers(manager) },
    );
    expect(reviewResponse.status()).toBe(200);
    const review = (await reviewResponse.json()).data;
    expect(review.expectedCashMinor).toEqual(expect.any(Number));

    const declareResponse = await cashier.api.post(
      `/v1/cash-sessions/${session}/declare`,
      {
        headers: headers(cashier),
        data: {
          version: beginning.version,
          declaredCashMinor: review.expectedCashMinor,
        },
      },
    );
    expect(declareResponse.status()).toBe(201);
    const declaration = (await declareResponse.json()).data;
    expect(declaration.expectedCashMinor).toBeNull();
    expect(declaration.varianceMinor).toBeNull();

    const secondReviewResponse = await manager.api.get(
      `/v1/cash-sessions/${session}/closing-review`,
      { headers: headers(manager) },
    );
    const secondReview = (await secondReviewResponse.json()).data;
    expect(secondReview.varianceMinor).toBe(0);
    const closeResponse = await manager.api.post(
      `/v1/cash-sessions/${session}/close`,
      {
        headers: headers(manager),
        data: { version: secondReview.version, approveVariance: false },
      },
    );
    expect(closeResponse.status()).toBe(201);

    const finalResponse = await cashier.api.get(
      `/v1/cash-sessions/${session}`,
      {
        headers: headers(cashier),
      },
    );
    const final = (await finalResponse.json()).data;
    expect(final.blindCount).toBe(false);
    expect(final.expectedCashMinor).toBe(review.expectedCashMinor);
    expect(final.varianceMinor).toBe(0);
  } finally {
    await close(cashier);
    await close(manager);
  }
});
