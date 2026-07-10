export const roles = ['PLATFORM_SUPER_ADMIN','SALON_OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER','NAIL_TECHNICIAN','ACCOUNTANT','MARKETING_STAFF','CUSTOMER'] as const;
export type Role = (typeof roles)[number];
export type Locale = 'vi-VN' | 'en-US';
export interface TenantContext { tenantId: string; branchId?: string; actorUserId: string; roles: Role[] }
export interface ApiSuccess<T> { success: true; data: T; meta: { requestId: string; timestamp: string } }
export interface ApiFailure { success: false; error: { code: string; message: string; details?: unknown }; meta: { requestId: string; timestamp: string } }
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
export interface LocalOperation<T = unknown> { operationId: string; type: string; entityId: string; baseVersion: number; payload: T; createdAtDevice: string; syncStatus: 'PENDING'|'SYNCING'|'COMPLETED'|'FAILED'|'CONFLICT' }
