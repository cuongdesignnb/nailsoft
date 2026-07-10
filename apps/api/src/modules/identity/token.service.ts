import { Injectable, UnauthorizedException } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { AccessClaims } from "./auth.types.js";
@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;
  constructor() {
    const fallback = "development-only-change-me-32-chars";
    const raw = process.env.JWT_SECRET ?? fallback;
    if (
      process.env.NODE_ENV === "production" &&
      (raw === fallback || raw.length < 32 || new Set(raw).size < 16)
    )
      throw new Error(
        "JWT_SECRET must be a non-default high-entropy secret of at least 32 characters in production",
      );
    this.secret = new TextEncoder().encode(raw);
  }
  async access(claims: AccessClaims) {
    return new SignJWT({
      tenantId: claims.tenantId,
      membershipId: claims.membershipId,
      authorizationVersion: claims.authorizationVersion,
      sessionId: claims.sessionId,
      roles: claims.roles,
      branchIds: claims.branchIds,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.userId)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(this.secret);
  }
  refresh() {
    return randomBytes(48).toString("base64url");
  }
  async workspace(userId: string) {
    return new SignJWT({ purpose: "workspace-selection" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(this.secret);
  }
  async mfa(input: {
    userId: string;
    membershipId: string;
    challengeId: string;
    state: "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED";
    device: { deviceId: string; deviceName: string; platform: "web" | "ios" | "android"; appVersion?: string };
  }) {
    return new SignJWT({
      purpose: "mfa-challenge",
      membershipId: input.membershipId,
      challengeId: input.challengeId,
      state: input.state,
      device: input.device,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(input.userId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(this.secret);
  }
  async verifyMfa(token: string) {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ["HS256"] });
      if (!payload.sub || payload.purpose !== "mfa-challenge" || typeof payload.membershipId !== "string" || typeof payload.challengeId !== "string" || (payload.state !== "MFA_REQUIRED" && payload.state !== "MFA_ENROLLMENT_REQUIRED") || typeof payload.device !== "object" || payload.device === null)
        throw new Error("claims");
      return {
        userId: payload.sub,
        membershipId: payload.membershipId,
        challengeId: payload.challengeId,
        state: payload.state,
        device: deviceClaims(payload.device),
      };
    } catch {
      throw new UnauthorizedException({ code: "MFA_CHALLENGE_EXPIRED", message: "MFA challenge is invalid or expired" });
    }
  }
  async verifyWorkspace(token: string) {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ["HS256"],
      });
      if (!payload.sub || payload.purpose !== "workspace-selection")
        throw new Error("claims");
      return payload.sub;
    } catch {
      throw new UnauthorizedException({
        code: "INVALID_WORKSPACE_TOKEN",
        message: "Workspace selection has expired",
      });
    }
  }
  hashRefresh(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ["HS256"],
      });
      if (
        !payload.sub ||
        typeof payload.tenantId !== "string" ||
        typeof payload.sessionId !== "string" ||
        typeof payload.membershipId !== "string" ||
        typeof payload.authorizationVersion !== "number" ||
        !Array.isArray(payload.roles) ||
        !Array.isArray(payload.branchIds)
      )
        throw new Error("claims");
      return {
        userId: payload.sub,
        tenantId: payload.tenantId,
        membershipId: payload.membershipId,
        authorizationVersion: payload.authorizationVersion,
        sessionId: payload.sessionId,
        roles: payload.roles as AccessClaims["roles"],
        branchIds: payload.branchIds as string[],
      };
    } catch {
      throw new UnauthorizedException({
        code: "INVALID_ACCESS_TOKEN",
        message: "Access token is invalid or expired",
      });
    }
  }
}

function deviceClaims(value: object) {
  const device = value as Record<string, unknown>;
  if (typeof device.deviceId !== "string" || typeof device.deviceName !== "string" || !["web", "ios", "android"].includes(String(device.platform))) throw new Error("device claims");
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    platform: device.platform as "web" | "ios" | "android",
    ...(typeof device.appVersion === "string" ? { appVersion: device.appVersion } : {}),
  };
}
