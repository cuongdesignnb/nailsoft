import { Injectable, UnauthorizedException } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";

@Injectable()
export class BookingTokenService {
  private readonly secret = new TextEncoder().encode(
    process.env.BOOKING_TOKEN_SECRET ??
      process.env.JWT_SECRET ??
      "development-only-change-me-32-chars",
  );

  hold(input: {
    tenantId: string;
    holdId: string;
    tokenVersion: number;
    expiresAt: Date | string;
  }) {
    return new SignJWT({
      purpose: "slot-hold",
      tenantId: input.tenantId,
      holdId: input.holdId,
      tokenVersion: input.tokenVersion,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(new Date(input.expiresAt))
      .sign(this.secret);
  }

  management(input: {
    tenantId: string;
    appointmentId: string;
    bookingReference: string;
    contactVerificationVersion: number;
    expiresIn?: string;
  }) {
    return new SignJWT({
      purpose: "booking-management",
      tenantId: input.tenantId,
      appointmentId: input.appointmentId,
      bookingReference: input.bookingReference.toUpperCase(),
      contactVerificationVersion: input.contactVerificationVersion,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(input.expiresIn ?? "15m")
      .sign(this.secret);
  }

  contact(input: {
    tenantId: string;
    contactHash: string;
    challengeId: string;
    expiresIn?: string;
  }) {
    return new SignJWT({
      purpose: "booking-contact",
      tenantId: input.tenantId,
      contactHash: input.contactHash,
      challengeId: input.challengeId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(input.expiresIn ?? "10m")
      .sign(this.secret);
  }

  async verifyHold(
    token: string,
    expected: { tenantId: string; holdId: string; tokenVersion: number },
  ) {
    const payload = await this.verify(token, "SLOT_HOLD_TOKEN_INVALID");
    if (
      payload.purpose !== "slot-hold" ||
      payload.tenantId !== expected.tenantId ||
      payload.holdId !== expected.holdId ||
      payload.tokenVersion !== expected.tokenVersion
    )
      throw new UnauthorizedException({
        code: "SLOT_HOLD_TOKEN_INVALID",
        message: "Slot hold token is invalid",
      });
  }

  async verifyManagement(token: string) {
    const payload = await this.verify(token, "BOOKING_ACCESS_TOKEN_INVALID");
    if (
      payload.purpose !== "booking-management" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.appointmentId !== "string" ||
      typeof payload.bookingReference !== "string" ||
      typeof payload.contactVerificationVersion !== "number"
    )
      throw new UnauthorizedException({
        code: "BOOKING_ACCESS_TOKEN_INVALID",
        message: "Booking management token is invalid",
      });
    return {
      tenantId: payload.tenantId,
      appointmentId: payload.appointmentId,
      bookingReference: payload.bookingReference,
      contactVerificationVersion: payload.contactVerificationVersion,
    };
  }

  async verifyContact(token: string) {
    const payload = await this.verify(token, "BOOKING_CONTACT_NOT_VERIFIED");
    if (
      payload.purpose !== "booking-contact" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.contactHash !== "string"
    )
      throw new UnauthorizedException({
        code: "BOOKING_CONTACT_NOT_VERIFIED",
        message: "Contact verification is required",
      });
    return { tenantId: payload.tenantId, contactHash: payload.contactHash };
  }

  private async verify(token: string, code: string) {
    try {
      return (await jwtVerify(token, this.secret, { algorithms: ["HS256"] }))
        .payload;
    } catch {
      throw new UnauthorizedException({
        code,
        message: "Capability token is invalid or expired",
      });
    }
  }
}
