import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const campaignId = "e9100000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const serviceId = "50000000-0000-4000-8000-000000000001";
const registerId = "a1000000-0000-4000-8000-000000000001";

async function responseData(response: any) {
  const text = await response.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    // The assertion below keeps a non-JSON server response visible in the failure.
  }
  expect(response.ok(), text).toBeTruthy();
  return body.data;
}

async function findPublicSlot(owner: Awaited<ReturnType<typeof login>>) {
  for (let offset = 1; offset <= 30; offset += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    const value = date.toISOString().slice(0, 10);
    const availability = await owner.api.get(
      `/v1/availability?branchId=${branchId}&serviceId=${serviceId}&dateFrom=${value}&dateTo=${value}&slotIntervalMin=5`,
      { headers: headers(owner) },
    );
    const body = await responseData(availability);
    const slot = body.days?.flatMap((day: any) => day.slots ?? [])[0];
    if (slot) return slot;
  }
  throw new Error("No future public booking slot was returned for G3");
}

async function createAttributedBooking(page: import("@playwright/test").Page, attributionReference: string) {
  await page.goto(
    `http://127.0.0.1:3002/book/nailsoft-demo?attribution=${encodeURIComponent(attributionReference)}`,
  );
  await expect(page.getByRole("heading", { name: /Select a branch|Chọn chi nhánh/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Q1|Quận 1/ }).click();
  await expect(page.getByRole("heading", { name: /Select services|Chọn dịch vụ/ }).first()).toBeVisible();
  await page.locator("button.choice").first().click();

  const dateInput = page.locator("#booking-date");
  const minimumDate = (await dateInput.getAttribute("min")) ?? "";
  const maximumDate = (await dateInput.getAttribute("max")) ?? minimumDate;
  const toDate = (value: string) => new Date(`${value}T12:00:00Z`);
  const dateValue = (value: Date) => value.toISOString().slice(0, 10);
  let foundSlot = false;
  for (
    let cursor = toDate(minimumDate);
    dateValue(cursor) <= maximumDate && !foundSlot;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    await dateInput.fill(dateValue(cursor));
    await page.getByRole("button", { name: /Find available times|Tìm giờ trống/ }).click();
    try {
      await expect.poll(() => page.locator(".slot").count(), { timeout: 5000 }).toBeGreaterThan(0);
      foundSlot = true;
    } catch {
      const change = page.getByRole("button", { name: /Change services or date|Đổi dịch vụ hoặc ngày/ });
      if (await change.count()) await change.click();
    }
  }
  expect(foundSlot).toBe(true);
  await page.locator(".slot").first().click();
  await expect(page.getByRole("heading", { name: /Contact details|Thông tin liên hệ/ }).first()).toBeVisible();
  await page.locator("#contact-name").fill("Khách 1");
  await page.locator("#contact-phone").fill("+84900000001");
  await page.locator("#contact-email").fill("customer1@example.test");
  await page.getByRole("button", { name: /Send verification code|Gửi mã xác minh/ }).click();
  await expect(page.locator("#verification-code")).toHaveValue("123456");
  await page.getByRole("button", { name: /Verify|Xác minh/ }).click();
  await expect(page.getByRole("heading", { name: /Review booking|Xem lại lịch hẹn/ })).toBeVisible();
  const consentInputs = page.locator('input[type="checkbox"]');
  await consentInputs.nth(0).check();
  await consentInputs.nth(1).check();
  await page.getByRole("button", { name: /Confirm booking|Xác nhận đặt lịch/ }).click();
  await expect(page.getByRole("heading", { name: /Booking confirmed|Đặt lịch thành công/ }).first()).toBeVisible();
  return page.locator(".booking-result strong").first().innerText();
}

async function payAppointment(owner: Awaited<ReturnType<typeof login>>, appointmentId: string) {
  const checkedInResponse = await owner.api.get(`/v1/appointments/${appointmentId}`, {
    headers: headers(owner),
  });
  const checkedInBefore = await responseData(checkedInResponse);
  const checkInResponse = await owner.api.post(`/v1/appointments/${appointmentId}/check-in`, {
    headers: headers(owner, `g3-check-in-${appointmentId}`),
    data: { version: checkedInBefore.version, overrideReason: "G3 authenticated journey" },
  });
  const checkedIn = await responseData(checkInResponse);
  expect(checkedIn.status).toBe("CHECKED_IN");

  const sessionsResponse = await owner.api.get(`/v1/service-sessions?appointmentId=${appointmentId}`, {
    headers: headers(owner),
  });
  const sessions = await responseData(sessionsResponse);
  expect(sessions.length).toBeGreaterThan(0);
  const detailResponse = await owner.api.get(`/v1/appointments/${appointmentId}`, {
    headers: headers(owner),
  });
  const detail = await responseData(detailResponse);
  const staffByItem = new Map(detail.items.map((item: any) => [item.id, item.staff?.id]));
  for (const session of sessions) {
    const staffId = session.currentStaffId ?? staffByItem.get(session.appointmentItemId);
    expect(staffId).toEqual(expect.any(String));
    const startedResponse = await owner.api.post(`/v1/service-sessions/${session.id}/start`, {
      headers: headers(owner, `g3-session-start-${session.id}`),
      data: { version: session.version, staffId },
    });
    const started = await responseData(startedResponse);
    const completedResponse = await owner.api.post(`/v1/service-sessions/${session.id}/complete`, {
      headers: headers(owner, `g3-session-complete-${session.id}`),
      data: { version: started.version, completionNote: "G3 service completed" },
    });
    expect((await responseData(completedResponse)).status).toBe("COMPLETED");
  }

  const checkoutResponse = await owner.api.get(`/v1/appointments/${appointmentId}/checkout-summary`, {
    headers: headers(owner),
  });
  const checkout = await responseData(checkoutResponse);
  expect(checkout.checkoutReady).toBe(true);
  const orderResponse = await owner.api.post(`/v1/appointments/${appointmentId}/pos-orders`, {
    headers: headers(owner, `g3-pos-create-${appointmentId}`),
    data: { registerId },
  });
  const order = await responseData(orderResponse);
  expect(order.status).toBe("DRAFT");

  const finalizedResponse = await owner.api.post(`/v1/pos-orders/${order.id}/finalize`, {
    headers: headers(owner, `g3-pos-finalize-${order.id}`),
    data: { version: order.version },
  });
  const finalized = await responseData(finalizedResponse);
  expect(finalized.status).toBe("READY_FOR_PAYMENT");
  expect(Number(finalized.amountDueMinor)).toBeGreaterThan(0);
  const paidResponse = await owner.api.post(`/v1/pos-orders/${order.id}/payments`, {
    headers: headers(owner, `g3-pos-pay-${order.id}`),
    data: {
      version: finalized.version,
      amountToApplyMinor: Number(finalized.amountDueMinor),
      tenderType: "CARD_EXTERNAL",
      provider: "E2E_G3",
      providerTransactionId: `g3-payment-${order.id}`,
      cardLast4: "4242",
    },
  });
  const paid = await responseData(paidResponse);
  expect(paid.status).toBe("PAID");
  return { order: paid, invoice: paid.invoice };
}

test("G3: explicit campaign booking to paid revenue and refund evidence", async ({ page }) => {
  test.setTimeout(240_000);
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const campaignResponse = await owner.api.get(`/v1/marketing-campaigns/${campaignId}`, {
      headers: headers(owner),
    });
    const campaign = await responseData(campaignResponse);
    expect(campaign.status).toBe("PENDING_APPROVAL");

    const approvedResponse = await owner.api.post(`/v1/marketing-campaigns/${campaignId}/approve`, {
      headers: headers(owner, "g3-campaign-approve"),
      data: { version: campaign.version },
    });
    const approved = await responseData(approvedResponse);
    expect(approved.status).toBe("APPROVED");

    const audienceResponse = await owner.api.get(`/v1/marketing-campaigns/${campaignId}/audience`, {
      headers: headers(owner),
    });
    const audience = await responseData(audienceResponse);
    const recipient = audience.find(
      (row: any) => row.customerId === customerId && row.generation === Number(approved.audience_generation),
    );
    expect(recipient?.id).toEqual(expect.any(String));
    expect(recipient.status).toBe("ELIGIBLE");

    const contextResponse = await owner.api.post(
      `/v1/marketing-campaigns/${campaignId}/audience/${recipient.id}/attribution-context`,
      { headers: headers(owner, "g3-context-issue") },
    );
    const context = await responseData(contextResponse);
    expect(context.model).toBe("EXPLICIT_LAST_TOUCH");
    expect(context.attributionReference).toEqual(expect.any(String));
    expect(context.bookingUrl).toContain("attribution=");

    const bookingReference = await createAttributedBooking(page, context.attributionReference);
    expect(bookingReference).toMatch(/^NS-/);
    const appointmentListResponse = await owner.api.get(
      `/v1/appointments?search=${encodeURIComponent(bookingReference)}&limit=10&offset=0`,
      { headers: headers(owner) },
    );
    const appointmentList = await responseData(appointmentListResponse);
    const appointment = appointmentList.find((row: any) => row.bookingReference === bookingReference);
    expect(appointment?.id).toEqual(expect.any(String));
    expect(appointment.customerId).toBe(customerId);

    const attachedResponse = await owner.api.get(
      `/v1/appointments/${appointment.id}/marketing-attribution`,
      { headers: headers(owner) },
    );
    const attached = await responseData(attachedResponse);
    expect(attached.status).toBe("ATTRIBUTED");
    expect(attached.model).toBe("EXPLICIT_LAST_TOUCH");
    expect(attached.campaignId).toBe(campaignId);

    const paid = await payAppointment(owner, appointment.id);
    expect(paid.order.status).toBe("PAID");
    expect(paid.invoice?.status ?? "ISSUED").toBe("ISSUED");
    const invoiceResponse = await owner.api.get(`/v1/invoices/${paid.invoice.id}`, {
      headers: headers(owner),
    });
    const invoice = await responseData(invoiceResponse);
    expect(invoice.status).toBe("ISSUED");
    const line = invoice.lines.find((item: any) => Number(item.netMinor) > 0);
    expect(line?.id).toEqual(expect.any(String));
    const gross = Number(line.netMinor);
    const beforeRefundResponse = await owner.api.get(`/v1/marketing-campaigns/${campaignId}/attribution`, {
      headers: headers(owner),
    });
    const beforeRefund = await responseData(beforeRefundResponse);
    const beforeGroup = beforeRefund.byCurrency.find((row: any) => row.currency === invoice.currency);
    expect(beforeGroup?.attributedBookings).toBeGreaterThanOrEqual(1);
    expect(beforeGroup?.completedAttributedBookings).toBeGreaterThanOrEqual(1);
    expect(beforeGroup?.attributedPaidOrders).toBeGreaterThanOrEqual(1);
    expect(beforeGroup?.grossRevenueMinor).toBe(gross);
    expect(beforeGroup?.refundMinor).toBe(0);
    expect(beforeGroup?.netRevenueMinor).toBe(gross);

    const refundAmount = Math.max(1, Math.floor(gross / 2));
    const refundCreateResponse = await owner.api.post(`/v1/invoices/${invoice.id}/refunds`, {
      headers: headers(owner, "g3-refund-create"),
      data: {
        items: [{ invoiceLineId: line.id, amountMinor: refundAmount }],
        tipAmountMinor: 0,
        refundDestination: "ORIGINAL_TENDER",
        reasonCode: "E2E_G3_PARTIAL_REFUND",
        reasonText: "G3 partial refund evidence",
      },
    });
    let refund = await responseData(refundCreateResponse);
    const submittedResponse = await owner.api.post(`/v1/refunds/${refund.id}/submit`, {
      headers: headers(owner, "g3-refund-submit"),
      data: { version: refund.version },
    });
    refund = await responseData(submittedResponse);
    const approvedRefundResponse = await manager.api.post(`/v1/refunds/${refund.id}/approve`, {
      headers: headers(manager, "g3-refund-approve"),
      data: { version: refund.version, reason: "Independent G3 refund approval" },
    });
    refund = await responseData(approvedRefundResponse);
    if (refund.status !== "COMPLETED") {
      const executedResponse = await owner.api.post(`/v1/refunds/${refund.id}/execute-external`, {
        headers: headers(owner, "g3-refund-execute"),
        data: {
          version: refund.version,
          provider: "E2E_G3",
          providerRefundId: `g3-refund-${refund.id}`,
          processedAt: new Date().toISOString(),
          evidenceNote: "G3 provider-confirmed partial refund",
        },
      });
      refund = await responseData(executedResponse);
    }
    expect(refund.status).toBe("COMPLETED");

    const afterRefundResponse = await owner.api.get(`/v1/marketing-campaigns/${campaignId}/attribution`, {
      headers: headers(owner),
    });
    const afterRefund = await responseData(afterRefundResponse);
    const afterGroup = afterRefund.byCurrency.find((row: any) => row.currency === invoice.currency);
    expect(afterGroup?.attributedBookings).toBe(beforeGroup.attributedBookings);
    expect(afterGroup?.completedAttributedBookings).toBe(beforeGroup.completedAttributedBookings);
    expect(afterGroup?.attributedPaidOrders).toBe(beforeGroup.attributedPaidOrders);
    expect(afterGroup?.grossRevenueMinor).toBe(gross);
    expect(afterGroup?.refundMinor).toBe(refundAmount);
    expect(afterGroup?.netRevenueMinor).toBe(gross - refundAmount);

    const replayResponse = await owner.api.get(`/v1/marketing-campaigns/${campaignId}/attribution`, {
      headers: headers(owner),
    });
    const replay = await responseData(replayResponse);
    const replayGroup = replay.byCurrency.find((row: any) => row.currency === invoice.currency);
    expect(replayGroup?.refundMinor).toBe(refundAmount);
    expect(replayGroup?.netRevenueMinor).toBe(gross - refundAmount);

    const customerResponse = await owner.api.get(`/v1/customers/${customerId}`, {
      headers: headers(owner),
    });
    expect((await responseData(customerResponse)).profile.id).toBe(customerId);

    await page.goto(`http://127.0.0.1:3000/auth/login`);
    await page.locator('input[name="email"]').fill("owner@example.test");
    await page.locator('input[name="password"]').fill("DemoPass123!");
    await Promise.all([
      page.waitForURL("**/admin/dashboard"),
      page.locator("form button").click(),
    ]);
    await page.goto(`http://127.0.0.1:3000/admin/marketing/campaigns?campaignId=${campaignId}`);
    await expect(page.getByRole("heading", { name: "Marketing khách hàng" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Booking & doanh thu được ghi nhận" })).toBeVisible();
    await expect(page.getByText(bookingReference, { exact: true })).toBeVisible();
    const sourceReference = paid.order.orderNumber ?? invoice.invoiceNumber;
    expect(sourceReference).toEqual(expect.any(String));
    await expect(page.getByText(sourceReference, { exact: true })).toBeVisible();
    await expect(page.getByText(/Refund đã điều chỉnh/)).toBeVisible();
    await expect(page.getByText(/Tỷ lệ mở|Đã mở|Tỷ lệ click|Click Rate|Opened|Clicked/, { exact: false })).toHaveCount(0);
    await page.goto(`http://127.0.0.1:3000/admin/marketing/campaigns/${campaignId}`);
    await expect(page.locator("h1").filter({ hasText: campaign.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Booking & doanh thu được ghi nhận" })).toBeVisible();
    await expect(page.getByText(bookingReference, { exact: true })).toBeVisible();
  } finally {
    await close(manager);
    await close(owner);
  }
});
