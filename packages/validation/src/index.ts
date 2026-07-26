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
export const publicAppointmentCustomerSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().email().max(254).optional(),
    locale: z.enum(["vi-VN", "en-US"]),
  })
  .strict()
  .refine((value) => Boolean(value.phone || value.email), {
    message: "phone or email is required",
  });
export const publicCreateAppointmentSchema = z
  .object({
    holdId: uuidSchema,
    holdToken: z.string().min(1),
    customer: publicAppointmentCustomerSchema,
    contactVerificationToken: z.string().min(1),
    customerNote: z.string().max(2000).optional(),
    marketingConsent: z.boolean(),
    acceptedPolicyVersion: z.number().int().positive(),
    acceptedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const bookingCustomerSearchSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const bookingCustomerCreateSchema = publicAppointmentCustomerSchema;
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

const optionalNote = z.string().trim().max(2000).optional();
export const walkInCreateSchema = z.object({
  branchId: uuidSchema,
  customerId: uuidSchema.optional(),
  displayName: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().email().max(254).optional(),
  source: z.enum(["RECEPTION", "KIOSK", "QR", "MOBILE"]).default("RECEPTION"),
  note: optionalNote,
  items: z
    .array(
      z.object({
        serviceId: uuidSchema,
        staffPreference: staffPreferenceSchema.default({ type: "ANY" }),
      }),
    )
    .min(1)
    .max(5),
});
export const versionedCommandSchema = z.object({
  version: z.number().int().positive(),
});
export const walkInStatusCommandSchema = versionedCommandSchema.extend({
  reasonCode: z.string().trim().max(80).optional(),
  note: optionalNote,
});
export const walkInUpdateSchema = versionedCommandSchema.extend({
  displayName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});
export const walkInPrioritySchema = versionedCommandSchema.extend({
  priority: z.enum(["NORMAL", "RECOVERY", "MANAGER_OVERRIDE"]),
  reason: z.string().trim().min(3).max(1000),
});
export const walkInConversionPlanSchema = z.object({
  desiredStartAt: z.string().datetime({ offset: true }).optional(),
});
export const walkInConversionHoldSchema = walkInConversionPlanSchema.extend({
  availabilityDataVersion: z.number().int().positive().optional(),
});
export const walkInConvertSchema = versionedCommandSchema.extend({
  holdId: uuidSchema,
  customerId: uuidSchema.optional(),
});
export const appointmentArrivalSchema = z.object({
  arrivalMethod: z
    .enum(["RECEPTION", "QR", "KIOSK", "MOBILE"])
    .default("RECEPTION"),
  partySize: z.number().int().min(1).max(50).default(1),
  note: optionalNote,
});
export const appointmentCheckInSchema = z.object({
  version: z.number().int().positive(),
  overrideReason: z.string().trim().min(3).max(1000).optional(),
});
export const appointmentRevertCheckInSchema = appointmentCheckInSchema.extend({
  reason: z.string().trim().min(3).max(1000),
});
export const sessionStartSchema = versionedCommandSchema.extend({
  staffId: uuidSchema,
  overrideReason: z.string().trim().max(1000).optional().nullable(),
});
export const sessionPauseSchema = versionedCommandSchema.extend({
  reasonCode: z.string().trim().min(1).max(80),
  note: optionalNote,
});
export const sessionResumeSchema = versionedCommandSchema.extend({
  staffId: uuidSchema,
});
export const sessionCompleteSchema = versionedCommandSchema.extend({
  completionNote: optionalNote,
});
export const sessionCancelSchema = versionedCommandSchema.extend({
  reasonCode: z.string().trim().min(1).max(80),
  note: optionalNote,
});
export const sessionTransferSchema = versionedCommandSchema.extend({
  targetStaffId: uuidSchema,
  reasonCode: z.string().trim().min(1).max(80),
  note: optionalNote,
});
export const serviceSessionNoteSchema = z.object({
  visibility: z.enum(["INTERNAL", "TECHNICIAN"]).default("TECHNICIAN"),
  note: z.string().trim().min(1).max(4000),
});
export const serviceSessionNoteUpdateSchema = serviceSessionNoteSchema.extend({
  version: z.number().int().positive(),
});
export const mediaPresignSchema = z.object({
  mediaType: z.enum(["BEFORE", "AFTER", "REFERENCE"]),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(15 * 1024 * 1024),
  checksum: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export const mediaCompleteSchema = z.object({
  checksum: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export const addServicePlanSchema = z.object({
  serviceId: uuidSchema,
  parentItemId: uuidSchema.nullable().optional(),
  staffPreference: staffPreferenceSchema.default({ type: "ANY" }),
});
export const addServiceCommitSchema = z.object({
  holdId: uuidSchema,
  version: z.number().int().positive(),
  parentItemId: uuidSchema.nullable().optional(),
  customerApprovalMethod: z.enum(["VERBAL", "DIGITAL", "WRITTEN"]),
  approvalNote: optionalNote,
});
