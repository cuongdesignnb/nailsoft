import { z } from 'zod';
export const uuidSchema = z.string().uuid();
export const tenantContextSchema = z.object({ tenantId: uuidSchema, branchId: uuidSchema.optional(), actorUserId: uuidSchema });
export const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const localOperationSchema = z.object({ operationId: uuidSchema, type: z.string().min(1), entityId: uuidSchema, baseVersion: z.number().int().nonnegative(), payload: z.unknown(), createdAtDevice: z.string().datetime({ offset: true }), syncStatus: z.enum(['PENDING','SYNCING','COMPLETED','FAILED','CONFLICT']) });
