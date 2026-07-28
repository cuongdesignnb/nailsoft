import { expect, type APIResponse } from "@playwright/test";
import { headers, type Session } from "./api-client";

export const appointmentForStoredValue = "70000000-0000-4000-8000-000000000035";
export const register = "a1000000-0000-4000-8000-000000000001";
export const product = "da100000-0000-4000-8000-000000000001";
export const draftOrder = "a4000000-0000-4000-8000-000000000001";
export const customer = "60000000-0000-4000-8000-000000000008";

export async function data(response: APIResponse, status = 201) {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  return JSON.parse(text).data;
}

export async function getOrder(session: Session, orderId: string) {
  return data(
    await session.api.get(`/v1/pos-orders/${orderId}`, {
      headers: headers(session),
    }),
    200,
  );
}

export async function createAppointmentOrder(session: Session, key: string) {
  return data(
    await session.api.post(
      `/v1/appointments/${appointmentForStoredValue}/pos-orders`,
      {
        headers: headers(session, `${key}-order`),
        data: { registerId: register },
      },
    ),
  );
}

export async function finalize(session: Session, orderId: string, key: string) {
  const current = await getOrder(session, orderId);
  if (current.finalizedAt) return current;
  return data(
    await session.api.post(`/v1/pos-orders/${orderId}/finalize`, {
      headers: headers(session, `${key}-finalize`),
      data: { version: current.version },
    }),
  );
}

export async function pay(
  session: Session,
  orderId: string,
  amountMinor: number,
  key: string,
) {
  const current = await getOrder(session, orderId);
  return data(
    await session.api.post(`/v1/pos-orders/${orderId}/payments`, {
      headers: headers(session, `${key}-payment`),
      data: {
        version: current.version,
        amountToApplyMinor: amountMinor,
        tenderType: "CARD_EXTERNAL",
        provider: "SPRINT10_CLOSURE",
        providerTransactionId: `${key}-${Date.now()}`,
        cardLast4: "4242",
      },
    }),
  );
}

export async function issueCard(
  session: Session,
  orderId: string,
  key: string,
  amountMinor = "100000",
) {
  return data(
    await session.api.post(`/v1/pos-orders/${orderId}/gift-card-lines`, {
      headers: headers(session, `${key}-line`),
      data: {
        productId: product,
        amountMinor,
        customerId: customer,
        form: "DIGITAL",
        deliveryChannel: "NONE",
      },
    }),
  );
}
