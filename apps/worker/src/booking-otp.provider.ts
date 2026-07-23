import { Injectable } from "@nestjs/common";

export type BookingOtpDelivery = {
  channel: "SMS" | "EMAIL";
  destination: string;
  code: string;
  purpose: string;
};

@Injectable()
export class BookingOtpProvider {
  constructor() {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.PUBLIC_BOOKING_ENABLED === "true" &&
      (!process.env.OTP_PROVIDER ||
        process.env.OTP_PROVIDER !== "webhook" ||
        !process.env.OTP_PROVIDER_URL)
    )
      throw new Error(
        "OTP_PROVIDER=webhook and OTP_PROVIDER_URL are required when public booking is enabled",
      );
  }

  async send(delivery: BookingOtpDelivery) {
    if (process.env.NODE_ENV !== "production") return;
    const response = await fetch(String(process.env.OTP_PROVIDER_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.OTP_PROVIDER_TOKEN
          ? { authorization: `Bearer ${process.env.OTP_PROVIDER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(delivery),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`OTP provider returned ${response.status}`);
  }
}
