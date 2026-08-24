import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const branchId = "20000000-0000-4000-8000-000000000001";
const serviceId = "50000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";
const registerId = "a1000000-0000-4000-8000-000000000001";
const seededCashSessionId = "a3000000-0000-4000-8000-000000000001";
const cashDrawerId = "a2000000-0000-4000-8000-000000000001";

async function responseData(response: any) {
  const body = await response.json();
  return body.data;
}

async function findFutureSlot(owner: Awaited<ReturnType<typeof login>>) {
  for (let offset = 1; offset <= 30; offset += 1) {
    const candidateDate = new Date();
    candidateDate.setUTCDate(candidateDate.getUTCDate() + offset);
    const date = candidateDate.toISOString().slice(0, 10);
    const availability = await owner.api.get(
      `/v1/availability?branchId=${branchId}&serviceId=${serviceId}&dateFrom=${date}&dateTo=${date}&slotIntervalMin=5`,
      { headers: headers(owner) },
    );
    expect(availability.status(), await availability.text()).toBe(200);
    const days = (await availability.json()).data.days as Array<{ slots: any[] }>;
    const slot = days.flatMap((day) => day.slots)[0];
    if (slot) return slot;
  }
  throw new Error("No future availability slot was returned for the seeded service");
}

async function closeCashSession(
  owner: Awaited<ReturnType<typeof login>>,
  sessionId: string,
  keyPrefix: string,
) {
  const openResponse = await owner.api.get(`/v1/cash-sessions/${sessionId}`, {
    headers: headers(owner),
  });
  expect(openResponse.status(), await openResponse.text()).toBe(200);
  const open = await responseData(openResponse as any);
  expect(open.status).toBe("OPEN");

  const beginResponse = await owner.api.post(
    `/v1/cash-sessions/${sessionId}/begin-closing`,
    {
      headers: headers(owner, `${keyPrefix}-begin`),
      data: { version: open.version },
    },
  );
  expect(beginResponse.status(), await beginResponse.text()).toBe(201);
  const beginning = await responseData(beginResponse as any);

  const reviewResponse = await owner.api.get(
    `/v1/cash-sessions/${sessionId}/closing-review`,
    { headers: headers(owner) },
  );
  expect(reviewResponse.status(), await reviewResponse.text()).toBe(200);
  const review = await responseData(reviewResponse as any);
  expect(review.expectedCashMinor).toEqual(expect.any(Number));

  const declareResponse = await owner.api.post(
    `/v1/cash-sessions/${sessionId}/declare`,
    {
      headers: headers(owner, `${keyPrefix}-declare`),
      data: {
        version: beginning.version,
        declaredCashMinor: review.expectedCashMinor,
      },
    },
  );
  expect(declareResponse.status(), await declareResponse.text()).toBe(201);

  const finalReviewResponse = await owner.api.get(
    `/v1/cash-sessions/${sessionId}/closing-review`,
    { headers: headers(owner) },
  );
  expect(finalReviewResponse.status(), await finalReviewResponse.text()).toBe(200);
  const finalReview = await responseData(finalReviewResponse as any);
  expect(finalReview.varianceMinor).toBe(0);

  const closeResponse = await owner.api.post(`/v1/cash-sessions/${sessionId}/close`, {
    headers: headers(owner, `${keyPrefix}-close`),
    data: { version: finalReview.version, approveVariance: false },
  });
  expect(closeResponse.status(), await closeResponse.text()).toBe(201);
  expect((await responseData(closeResponse as any)).status).toBe("CLOSED");
}

test("G1: walk-in to paid checkout, customer care follow-up, and cash close", async () => {
  test.setTimeout(180_000);
  const owner = await login("owner@example.test");
  let cashSessionId = "";

  try {
    const customerDirectoryResponse = await owner.api.get("/v1/customers?limit=100", {
      headers: headers(owner),
    });
    expect(customerDirectoryResponse.status(), await customerDirectoryResponse.text()).toBe(200);
    const customerDirectory = await customerDirectoryResponse.json();
    const seededCustomer = customerDirectory.data.find(
      (item: { id: string }) => item.id === customerId,
    );
    expect(seededCustomer).toBeTruthy();

    const searchedCustomerResponse = await owner.api.get(
      `/v1/customers?search=${encodeURIComponent(seededCustomer.displayName)}&limit=20`,
      { headers: headers(owner) },
    );
    expect(searchedCustomerResponse.status(), await searchedCustomerResponse.text()).toBe(200);
    const searchedCustomer = await searchedCustomerResponse.json();
    expect(searchedCustomer.data.some((item: { id: string }) => item.id === customerId)).toBe(true);

    const customerDetailResponse = await owner.api.get(`/v1/customers/${customerId}`, {
      headers: headers(owner),
    });
    expect(customerDetailResponse.status(), await customerDetailResponse.text()).toBe(200);
    expect((await customerDetailResponse.json()).data.profile.id).toBe(customerId);

    await closeCashSession(owner, seededCashSessionId, "qa-g1-seeded-cash-session");
    const openedCashSessionResponse = await owner.api.post("/v1/cash-sessions/open", {
      headers: headers(owner, "qa-g1-cash-session-open"),
      data: { registerId, cashDrawerId, openingFloatMinor: 0 },
    });
    expect(openedCashSessionResponse.status(), await openedCashSessionResponse.text()).toBe(201);
    const openedCashSession = await responseData(openedCashSessionResponse as any);
    cashSessionId = openedCashSession.id;
    expect(openedCashSession.status).toBe("OPEN");

    const slot = await findFutureSlot(owner);
    const staffId = slot.staffCandidates[0].staffId;

    const createdResponse = await owner.api.post("/v1/walk-ins", {
      headers: headers(owner, "qa-g1-walkin-create"),
      data: {
        branchId,
        customerId,
        displayName: "QA G1 customer",
        source: "RECEPTION",
        items: [
          {
            serviceId,
            staffPreference: { type: "SPECIFIC", staffId },
          },
        ],
      },
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const walkIn = await responseData(createdResponse as any);
    expect(walkIn.id).toEqual(expect.any(String));

    const readyResponse = await owner.api.post(`/v1/walk-ins/${walkIn.id}/ready`, {
      headers: headers(owner, "qa-g1-walkin-ready"),
      data: { version: walkIn.version },
    });
    expect(readyResponse.status(), await readyResponse.text()).toBe(201);
    const ready = await responseData(readyResponse as any);

    const holdResponse = await owner.api.post(
      `/v1/walk-ins/${walkIn.id}/conversion-holds`,
      {
        headers: headers(owner, "qa-g1-walkin-conversion-hold"),
        data: { desiredStartAt: slot.startAt },
      },
    );
    expect(holdResponse.status(), await holdResponse.text()).toBe(201);
    const hold = await responseData(holdResponse as any);

    const convertedResponse = await owner.api.post(`/v1/walk-ins/${walkIn.id}/convert`, {
      headers: headers(owner, "qa-g1-walkin-convert"),
      data: { version: ready.version, holdId: hold.holdId, customerId },
    });
    expect(convertedResponse.status(), await convertedResponse.text()).toBe(201);
    const converted = await responseData(convertedResponse as any);
    const appointmentId = converted.appointmentId;
    expect(appointmentId).toEqual(expect.any(String));

    const appointmentBeforeCheckInResponse = await owner.api.get(
      `/v1/appointments/${appointmentId}`,
      { headers: headers(owner) },
    );
    expect(appointmentBeforeCheckInResponse.status()).toBe(200);
    const appointmentBeforeCheckIn = await responseData(appointmentBeforeCheckInResponse as any);
    expect(appointmentBeforeCheckIn.status).toBe("CONFIRMED");

    const checkedInResponse = await owner.api.post(
      `/v1/appointments/${appointmentId}/check-in`,
      {
        headers: headers(owner, "qa-g1-appointment-check-in"),
        data: {
          version: appointmentBeforeCheckIn.version,
          overrideReason: "QA golden journey check-in",
        },
      },
    );
    expect(checkedInResponse.status(), await checkedInResponse.text()).toBe(201);
    const checkedIn = await responseData(checkedInResponse as any);
    expect(checkedIn.status).toBe("CHECKED_IN");

    const addPlanResponse = await owner.api.post(
      `/v1/appointments/${appointmentId}/add-service-plans`,
      {
        headers: headers(owner),
        data: { serviceId, staffPreference: { type: "ANY" } },
      },
    );
    expect(addPlanResponse.status(), await addPlanResponse.text()).toBe(201);

    const addHoldResponse = await owner.api.post(
      `/v1/appointments/${appointmentId}/add-service-holds`,
      {
        headers: headers(owner, "qa-g1-add-service-hold"),
        data: { serviceId, staffPreference: { type: "ANY" } },
      },
    );
    expect(addHoldResponse.status(), await addHoldResponse.text()).toBe(201);
    const addHold = await responseData(addHoldResponse as any);

    const addCommitResponse = await owner.api.post(
      `/v1/appointments/${appointmentId}/add-service`,
      {
        headers: headers(owner, "qa-g1-add-service-commit"),
        data: {
          holdId: addHold.holdId,
          version: checkedIn.version,
          customerApprovalMethod: "VERBAL",
          approvalNote: "QA customer approval",
        },
      },
    );
    expect(addCommitResponse.status(), await addCommitResponse.text()).toBe(201);

    const sessionsResponse = await owner.api.get(
      `/v1/service-sessions?appointmentId=${appointmentId}`,
      { headers: headers(owner) },
    );
    expect(sessionsResponse.status(), await sessionsResponse.text()).toBe(200);
    const sessions = await responseData(sessionsResponse as any);
    expect(sessions.length).toBe(2);
    const appointmentDetailResponse = await owner.api.get(
      `/v1/appointments/${appointmentId}`,
      { headers: headers(owner) },
    );
    expect(appointmentDetailResponse.status()).toBe(200);
    const appointmentDetail = await responseData(appointmentDetailResponse as any);
    const assignedStaffByItem = new Map(
      appointmentDetail.items.map((item: any) => [item.id, item.staff.id]),
    );
    for (const session of sessions) {
      const assignedStaffId = session.currentStaffId ?? assignedStaffByItem.get(session.appointmentItemId);
      expect(assignedStaffId).toEqual(expect.any(String));
      const startedResponse = await owner.api.post(
        `/v1/service-sessions/${session.id}/start`,
        {
          headers: headers(owner, `qa-g1-session-start-${session.id}`),
          data: { version: session.version, staffId: assignedStaffId },
        },
      );
      expect(startedResponse.status(), await startedResponse.text()).toBe(201);
      const started = await responseData(startedResponse as any);
      expect(started.status).toBe("IN_PROGRESS");

      const completedResponse = await owner.api.post(
        `/v1/service-sessions/${session.id}/complete`,
        {
          headers: headers(owner, `qa-g1-session-complete-${session.id}`),
          data: {
            version: started.version,
            completionNote: "QA golden journey completed",
          },
        },
      );
      expect(completedResponse.status(), await completedResponse.text()).toBe(201);
      expect((await responseData(completedResponse as any)).status).toBe("COMPLETED");
    }

    const checkoutResponse = await owner.api.get(
      `/v1/appointments/${appointmentId}/checkout-summary`,
      { headers: headers(owner) },
    );
    expect(checkoutResponse.status(), await checkoutResponse.text()).toBe(200);
    const checkout = await responseData(checkoutResponse as any);
    expect(checkout.checkoutReady).toBe(true);
    expect(checkout.items).toHaveLength(2);

    const posCreateResponse = await owner.api.post(
      `/v1/appointments/${appointmentId}/pos-orders`,
      {
        headers: headers(owner, "qa-g1-pos-create"),
        data: { registerId },
      },
    );
    expect(posCreateResponse.status(), await posCreateResponse.text()).toBe(201);
    const order = await responseData(posCreateResponse as any);
    expect(order.status).toBe("DRAFT");

    const tipResponse = await owner.api.post(`/v1/pos-orders/${order.id}/tip`, {
      headers: headers(owner, "qa-g1-tip-command"),
      data: {
        version: order.version,
        amountMinor: 1_000,
        source: "CUSTOMER",
        allocationBasis: "EQUAL",
      },
    });
    expect(tipResponse.status(), await tipResponse.text()).toBe(201);
    const tippedOrder = await responseData(tipResponse as any);

    const finalizedResponse = await owner.api.post(`/v1/pos-orders/${order.id}/finalize`, {
      headers: headers(owner, "qa-g1-pos-finalize"),
      data: { version: tippedOrder.version },
    });
    expect(finalizedResponse.status(), await finalizedResponse.text()).toBe(201);
    const finalized = await responseData(finalizedResponse as any);
    expect(finalized.status).toBe("READY_FOR_PAYMENT");
    const amountDueMinor = Number(finalized.amountDueMinor);
    expect(amountDueMinor).toBeGreaterThan(0);

    const cashSessionResponse = await owner.api.get(`/v1/cash-sessions/${cashSessionId}`, {
      headers: headers(owner),
    });
    expect(cashSessionResponse.status(), await cashSessionResponse.text()).toBe(200);
    expect((await responseData(cashSessionResponse as any)).status).toBe("OPEN");

    const paidResponse = await owner.api.post(`/v1/pos-orders/${order.id}/payments`, {
      headers: headers(owner, "qa-g1-cash-payment"),
      data: {
        version: finalized.version,
        amountToApplyMinor: amountDueMinor,
        tenderType: "CASH",
        cashReceivedMinor: amountDueMinor,
        cashSessionId,
      },
    });
    expect(paidResponse.status(), await paidResponse.text()).toBe(201);
    const paid = await responseData(paidResponse as any);
    expect(paid.status).toBe("PAID");

    const invoiceListResponse = await owner.api.get("/v1/invoices", {
      headers: headers(owner),
    });
    expect(invoiceListResponse.status(), await invoiceListResponse.text()).toBe(200);
    const invoice = (await responseData(invoiceListResponse as any)).find(
      (item: { orderId: string }) => item.orderId === order.id,
    );
    expect(invoice).toBeTruthy();
    expect(invoice.status).toBe("ISSUED");

    const benefitEligibilityResponse = await owner.api.get(
      `/v1/pos-orders/${order.id}/benefits/eligibility`,
      { headers: headers(owner) },
    );
    expect(benefitEligibilityResponse.status(), await benefitEligibilityResponse.text()).toBe(200);
    const benefitListResponse = await owner.api.get(`/v1/pos-orders/${order.id}/benefits`, {
      headers: headers(owner),
    });
    expect(benefitListResponse.status(), await benefitListResponse.text()).toBe(200);

    const customerReadModels = [
      `/v1/customers/${customerId}/benefits/summary`,
      `/v1/customers/${customerId}/loyalty/overview`,
      `/v1/customers/${customerId}/membership/summary`,
      `/v1/customers/${customerId}/packages`,
      `/v1/customers/${customerId}/customer-credit`,
    ];
    for (const path of customerReadModels) {
      const response = await owner.api.get(path, { headers: headers(owner) });
      expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
    }

    const commissionResponse = await owner.api.get("/v1/commission-entries", {
      headers: headers(owner),
    });
    expect(commissionResponse.status(), await commissionResponse.text()).toBe(200);
    const commissionRows = (await commissionResponse.json()).data;
    expect(
      commissionRows.some((entry: { invoiceId: string; baseMinor: number | null }) =>
        entry.invoiceId === invoice.id && entry.baseMinor !== null,
      ),
    ).toBe(true);

    const activityResponse = await owner.api.post("/v1/customer-care/activities", {
      headers: headers(owner, "qa-g1-care-activity"),
      data: {
        activityType: "CALL",
        branchId,
        customerId,
        outcomeCode: "RESOLVED",
        summary: "QA follow-up call after completed appointment",
        related: { type: "APPOINTMENT", id: appointmentId },
      },
    });
    expect(activityResponse.status(), await activityResponse.text()).toBe(201);
    const activity = await responseData(activityResponse as any);
    expect(activity.activityType).toBe("CALL");

    const followupResponse = await owner.api.post("/v1/customer-care/followups", {
      headers: headers(owner, "qa-g1-care-followup"),
      data: {
        branchId,
        customerId,
        reason: "QA confirm customer satisfaction",
        dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        priority: "MEDIUM",
        sourceActivityId: activity.id,
        related: { type: "APPOINTMENT", id: appointmentId },
      },
    });
    expect(followupResponse.status(), await followupResponse.text()).toBe(201);
    const followup = await responseData(followupResponse as any);
    expect(followup.status).toBe("OPEN");

    const careDirectoryResponse = await owner.api.get(
      `/v1/customer-care/directory?customerId=${customerId}&page=1&pageSize=50`,
      { headers: headers(owner) },
    );
    expect(careDirectoryResponse.status(), await careDirectoryResponse.text()).toBe(200);
    const careDirectory = await responseData(careDirectoryResponse as any);
    expect(careDirectory.items.some((item: any) => item.sourceId === activity.id)).toBe(true);
    expect(careDirectory.items.some((item: any) => item.sourceId === followup.id)).toBe(true);

    const completedFollowupResponse = await owner.api.post(
      `/v1/customer-care/followups/${followup.id}/complete`,
      {
        headers: headers(owner, "qa-g1-care-followup-complete"),
        data: { version: followup.version },
      },
    );
    expect(completedFollowupResponse.status(), await completedFollowupResponse.text()).toBe(201);
    expect((await responseData(completedFollowupResponse as any)).status).toBe("COMPLETED");

    const overviewResponse = await owner.api.get(
      "/v1/customer-care/overview?careInactivityDays=60",
      { headers: headers(owner) },
    );
    expect(overviewResponse.status(), await overviewResponse.text()).toBe(200);
    const overview = await responseData(overviewResponse as any);
    expect(overview.generatedAt).toEqual(expect.any(String));
    expect(overview.totals.activitiesToday).toEqual(expect.any(Number));

    await closeCashSession(owner, cashSessionId, "qa-g1-cash-session");
  } finally {
    await close(owner);
  }
});
