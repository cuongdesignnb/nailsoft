import { Injectable, UnauthorizedException } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { AccessClaims } from "./auth.types.js";
@Injectable()
export class TokenService {
  private readonly secret = new TextEncoder().encode(
    process.env.JWT_SECRET ?? "development-only-change-me-32-chars",
  );
  async access(claims: AccessClaims) {
    return new SignJWT({
      tenantId: claims.tenantId,
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
        !Array.isArray(payload.roles) ||
        !Array.isArray(payload.branchIds)
      )
        throw new Error("claims");
      return {
        userId: payload.sub,
        tenantId: payload.tenantId,
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
