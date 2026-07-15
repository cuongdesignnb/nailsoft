import { z } from "zod";
export const uuidSchema = z.string().uuid();
export const tenantContextSchema = z.object({
  tenantId: uuidSchema,
  branchId: uuidSchema.optional(),
  actorUserId: uuidSchema,
});
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const localOperationSchema = z.object({
  operationId: uuidSchema,
  type: z.string().min(1),
  entityId: uuidSchema,
  baseVersion: z.number().int().nonnegative(),
  payload: z.unknown(),
  createdAtDevice: z.string().datetime({ offset: true }),
  syncStatus: z.enum(["PENDING", "SYNCING", "COMPLETED", "FAILED", "CONFLICT"]),
});
export const availabilityQuerySchema = z
  .object({
    branchId: uuidSchema,
    serviceId: uuidSchema,
    dateFrom: z.string().date(),
    dateTo: z.string().date(),
    staffId: uuidSchema.optional(),
    slotIntervalMin: z
      .union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)])
      .default(15),
  })
  .refine((x) => x.dateTo >= x.dateFrom, {
    message: "dateTo must be on or after dateFrom",
  });
export const availabilityBlockSchema = z
  .object({
    branchId: uuidSchema,
    staffId: uuidSchema.nullable().optional(),
    resourceId: uuidSchema.nullable().optional(),
    blockType: z.enum(["MANUAL", "EXTERNAL", "MAINTENANCE"]),
    title: z.string().trim().min(1).max(200),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    source: z.string().max(100).nullable().optional(),
    sourceReference: z.string().max(255).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .refine((x) => !!x.staffId || !!x.resourceId, {
    message: "staffId or resourceId is required",
  })
  .refine((x) => x.endAt > x.startAt, {
    message: "endAt must be after startAt",
  });
export const staffPreferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ANY") }),
  z.object({ type: z.literal("SPECIFIC"), staffId: uuidSchema }),
]);
export const bookingPlanSchema = z.object({
  branchId: uuidSchema,
  desiredStartAt: z.string().datetime({ offset: true }),
  items: z
    .array(
      z.object({
        serviceId: uuidSchema,
        staffPreference: staffPreferenceSchema,
        availabilityFingerprint: z.string().length(64).optional(),
      }),
    )
    .min(1)
    .max(5),
});
export const createSlotHoldSchema = bookingPlanSchema.extend({
  availabilityDataVersion: z.number().int().positive().optional(),
  clientKey: z.string().min(8).max(200).optional(),
  source: z
    .enum(["CUSTOMER_WEB", "RECEPTION", "OWNER_MOBILE", "API"])
    .default("RECEPTION"),
});
export const appointmentCustomerSchema = z
  .object({
    customerId: uuidSchema.optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().max(32).optional(),
    email: z.string().email().max(254).optional(),
    locale: z.enum(["vi-VN", "en-US"]).default("vi-VN"),
  })
  .refine((x) => !!x.customerId || !!x.displayName, {
    message: "customerId or displayName is required",
  });
export const createAppointmentSchema = z.object({
  holdId: uuidSchema,
  holdToken: z.string().optional(),
  customer: appointmentCustomerSchema,
  contactVerificationToken: z.string().optional(),
  customerNote: z.string().max(2000).optional(),
  internalNote: z.string().max(4000).optional(),
  marketingConsent: z.boolean().default(false),
  acceptedPolicyVersion: z.number().int().positive().optional(),
  confirm: z.boolean().default(true),
});
export const appointmentVersionSchema = z.object({
  version: z.number().int().positive(),
});
export const appointmentCancelSchema = appointmentVersionSchema.extend({
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().max(2000).optional(),
  actorType: z.enum(["USER", "CUSTOMER"]).default("USER"),
  policyOverrideReason: z.string().max(1000).optional(),
});
export const appointmentRescheduleSchema = appointmentVersionSchema.extend({
  replacementHoldId: uuidSchema,
  replacementHoldToken: z.string().optional(),
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().max(2000).optional(),
  actorType: z.enum(["USER", "CUSTOMER"]).default("USER"),
});
export const depositWaiverSchema = appointmentVersionSchema.extend({
  reason: z.string().trim().min(3).max(1000),
});
