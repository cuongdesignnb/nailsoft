import type { Role } from "@nailsoft/domain-types";
export interface AccessClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
  roles: Role[];
  branchIds: string[];
}
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  auth: AccessClaims;
  raw: { requestId?: string };
  ip?: string;
}
