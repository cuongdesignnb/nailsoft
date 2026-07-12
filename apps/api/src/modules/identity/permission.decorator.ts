import { SetMetadata } from "@nestjs/common";
export const PERMISSION_KEY = "permission";
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
