/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  recoveryCaseSchema,
  recoveryCompensationSchema,
  reviewSubmitSchema,
} from "@nailsoft/validation";
import type { AccessClaims } from "../identity/auth.types.js";
import { BenefitsCatalogService } from "../benefits/benefits-catalog.service.js";
import { StoredValueService } from "../stored-value/stored-value.service.js";
import { CommunicationService } from "./communication.service.js";
import {
  assertTransition,
  recoverySlaHours,
  recoveryTransitions,
  signPublicToken,
  verifyPublicToken,
} from "./engagement-domain.js";

@Injectable()
export class ReviewRecoveryService {
  constructor(
    @Inject(CommunicationService) readonly core: CommunicationService,
    @Inject(BenefitsCatalogService) readonly benefits: BenefitsCatalogService,
    @Inject(StoredValueService) readonly storedValue: StoredValueService,
  ) {}
  private tokenSecret() {
    const secret =
      process.env.COMMUNICATION_TOKEN_SECRET ?? process.env.JWT_SECRET;
    if (secret) return secret;
    if (process.env.NODE_ENV === "production")
      throw new Error("COMMUNICATION_TOKEN_SECRET_REQUIRED");
    return "development-only-communication-secret";
  }
  private tokenHash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  reviews(auth: AccessClaims) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        `SELECT r.id,r.branch_id "branchId",r.customer_id "customerId",r.appointment_id "appointmentId",r.invoice_id "invoiceId",r.overall_rating "overallRating",r.comment,r.status,r.version,r.submitted_at "submittedAt",c.display_name "customerDisplayName" FROM customer_reviews r JOIN customers c ON c.tenant_id=r.tenant_id AND c.id=r.customer_id WHERE r.tenant_id=$1 AND ($2::uuid[] IS NULL OR r.branch_id=ANY($2::uuid[])) ORDER BY r.submitted_at DESC`,
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  review(auth: AccessClaims, id: string) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        `SELECT r.*,COALESCE(json_agg(resp ORDER BY resp.version) FILTER(WHERE resp.id IS NOT NULL),'[]') responses FROM customer_reviews r LEFT JOIN review_responses resp ON resp.tenant_id=r.tenant_id AND resp.review_id=r.id WHERE r.tenant_id=$1 AND r.id=$2 GROUP BY r.id`,
        [auth.tenantId, id],
      )
      .then((r) => {
        const row = r.rows[0];
        if (!row) this.core.notFound("REVIEW_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        return row;
      });
  }
  moderate(
    auth: AccessClaims,
    id: string,
    status: "PUBLISHED" | "HIDDEN" | "FLAGGED",
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      `review.${status.toLowerCase()}`,
      key,
      { id, status, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM customer_reviews WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("REVIEW_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (input?.version && input.version !== row.version)
          this.core.conflict("VERSION_CONFLICT");
        if (
          ["HIDDEN", "FLAGGED"].includes(status) &&
          !String(input?.reason ?? "").trim()
        )
          this.core.conflict("REVIEW_MODERATION_REASON_REQUIRED");
        const updated = (
          await c.query<any>(
            `UPDATE customer_reviews SET status=$3,hidden_at=CASE WHEN $3='HIDDEN' THEN now() ELSE hidden_at END,published_at=CASE WHEN $3='PUBLISHED' THEN now() ELSE published_at END,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [auth.tenantId, id, status],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          `review.${status.toLowerCase()}`,
          "customer_review",
          id,
          requestId,
          row.branch_id,
          { reason: input?.reason ?? null },
        );
        return updated;
      },
    );
  }
  respond(
    auth: AccessClaims,
    id: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const text = String(input?.responseText ?? "").trim();
    if (text.length < 3 || text.length > 5000)
      this.core.conflict("REVIEW_RESPONSE_INVALID");
    return this.core.command(
      auth,
      "review.respond",
      key,
      { id, responseText: text },
      async (c) => {
        const review = (
          await c.query<any>(
            "SELECT * FROM customer_reviews WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!review) this.core.notFound("REVIEW_NOT_FOUND");
        this.core.branch(auth, review.branch_id);
        const version = Number(
          (
            await c.query<any>(
              "SELECT COALESCE(max(version),0)+1 n FROM review_responses WHERE tenant_id=$1 AND review_id=$2",
              [auth.tenantId, id],
            )
          ).rows[0].n,
        );
        const row = (
          await c.query<any>(
            "INSERT INTO review_responses(tenant_id,review_id,response_text,version,author_user_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [auth.tenantId, id, text, version, auth.userId],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "review.responded",
          "customer_review",
          id,
          requestId,
          review.branch_id,
          { responseVersion: version },
        );
        return row;
      },
    );
  }
  reviewRequests(auth: AccessClaims) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        "SELECT id,branch_id,customer_id,appointment_id,invoice_id,status,expires_at,sent_at,submitted_at,created_at FROM review_requests WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) ORDER BY created_at DESC",
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  requestStatus(
    auth: AccessClaims,
    id: string,
    status: "PENDING" | "CANCELLED",
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      `review-request.${status.toLowerCase()}`,
      key,
      { id },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM review_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("REVIEW_REQUEST_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (["SUBMITTED", "EXPIRED", "CANCELLED"].includes(row.status))
          this.core.conflict("REVIEW_REQUEST_STATUS_INVALID");
        const updated = (
          await c.query<any>(
            "UPDATE review_requests SET status=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, status],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          `review_request.${status.toLowerCase()}`,
          "review_request",
          id,
          requestId,
          row.branch_id,
        );
        return updated;
      },
    );
  }
  async publicReviewRequest(token: string) {
    const payload = verifyPublicToken(token, this.tokenSecret());
    const row = (
      await this.core.db.query<any>(
        `SELECT rr.id,rr.status,rr.expires_at "expiresAt",a.booking_reference "bookingReference",b.name "branchName" FROM review_requests rr JOIN appointments a ON a.tenant_id=rr.tenant_id AND a.id=rr.appointment_id JOIN branches b ON b.tenant_id=rr.tenant_id AND b.id=rr.branch_id WHERE rr.tenant_id=$1 AND rr.id=$2 AND rr.token_hash=$3`,
        [payload.tenantId, payload.reviewRequestId, this.tokenHash(token)],
      )
    ).rows[0];
    if (!row) this.core.notFound("REVIEW_REQUEST_NOT_FOUND");
    return {
      ...row,
      tokenValid: row.status === "SENT" && new Date(row.expiresAt) > new Date(),
    };
  }
  submitPublicReview(input: unknown, key: string, requestId: string) {
    const b = reviewSubmitSchema.parse(input);
    const payload = verifyPublicToken(b.token, this.tokenSecret());
    const tenantId = String(payload.tenantId);
    return this.core.db.transaction(
      async (c) =>
        (
          await this.core.idem.execute(c, {
            tenantId,
            actorScope: `public-review:${payload.reviewRequestId}`,
            command: "review.submit",
            key,
            request: { ...b, token: "[REDACTED]" },
            work: async () => {
              const rr = (
                await c.query<any>(
                  "SELECT * FROM review_requests WHERE tenant_id=$1 AND id=$2 AND token_hash=$3 FOR UPDATE",
                  [tenantId, payload.reviewRequestId, this.tokenHash(b.token)],
                )
              ).rows[0];
              if (!rr) this.core.notFound("REVIEW_REQUEST_NOT_FOUND");
              if (rr.status !== "SENT" || new Date(rr.expires_at) <= new Date())
                this.core.conflict("REVIEW_REQUEST_STATUS_INVALID");
              const evidence = (
                await c.query<any>(
                  `SELECT a.status appointment_status,i.status invoice_status,o.status order_status,i.paid_minor,i.total_minor,i.tip_minor FROM appointments a JOIN pos_orders o ON o.tenant_id=a.tenant_id AND o.appointment_id=a.id JOIN invoices i ON i.tenant_id=o.tenant_id AND i.pos_order_id=o.id WHERE a.tenant_id=$1 AND a.id=$2 AND i.id=$3 AND a.customer_id=$4`,
                  [tenantId, rr.appointment_id, rr.invoice_id, rr.customer_id],
                )
              ).rows[0];
              if (
                !evidence ||
                evidence.appointment_status !== "COMPLETED" ||
                evidence.invoice_status !== "ISSUED" ||
                evidence.order_status !== "PAID" ||
                BigInt(evidence.paid_minor) <
                  BigInt(evidence.total_minor) + BigInt(evidence.tip_minor)
              )
                this.core.conflict("REVIEW_TRANSACTION_NOT_VERIFIED");
              const id = randomUUID();
              try {
                await c.query(
                  `INSERT INTO customer_reviews(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,review_request_id,overall_rating,service_rating,cleanliness_rating,staff_rating,comment,verified_evidence_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                  [
                    id,
                    tenantId,
                    rr.branch_id,
                    rr.customer_id,
                    rr.appointment_id,
                    rr.invoice_id,
                    rr.id,
                    b.overallRating,
                    b.serviceRating ?? null,
                    b.cleanlinessRating ?? null,
                    b.staffRating ?? null,
                    b.comment ?? null,
                    JSON.stringify({
                      appointmentStatus: evidence.appointment_status,
                      invoiceStatus: evidence.invoice_status,
                      orderStatus: evidence.order_status,
                      verifiedAt: new Date().toISOString(),
                    }),
                  ],
                );
              } catch (error: any) {
                if (error?.code === "23505")
                  this.core.conflict("REVIEW_ALREADY_SUBMITTED");
                throw error;
              }
              await c.query(
                "INSERT INTO customer_review_revisions(tenant_id,review_id,revision_number,rating_snapshot_json,comment,actor_type) VALUES($1,$2,1,$3,$4,'CUSTOMER')",
                [
                  tenantId,
                  id,
                  JSON.stringify({
                    overall: b.overallRating,
                    service: b.serviceRating,
                    cleanliness: b.cleanlinessRating,
                    staff: b.staffRating,
                  }),
                  b.comment ?? null,
                ],
              );
              await c.query(
                "UPDATE review_requests SET status='SUBMITTED',submitted_at=now() WHERE tenant_id=$1 AND id=$2",
                [tenantId, rr.id],
              );
              const settings = (
                await c.query<any>(
                  "SELECT * FROM communication_settings WHERE tenant_id=$1",
                  [tenantId],
                )
              ).rows[0];
              let recoveryCaseId: string | null = null;
              if (
                settings.auto_create_recovery_case &&
                b.overallRating <= settings.low_rating_threshold
              )
                recoveryCaseId = await this.createLowRatingCase(
                  c,
                  tenantId,
                  rr,
                  id,
                  b.overallRating,
                  requestId,
                );
              await c.query(
                "INSERT INTO audit_logs(tenant_id,branch_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,'review.submitted','customer_review',$3,$4,$5)",
                [
                  tenantId,
                  rr.branch_id,
                  id,
                  JSON.stringify({
                    rating: b.overallRating,
                    verified: true,
                    recoveryCaseCreated: Boolean(recoveryCaseId),
                  }),
                  requestId,
                ],
              );
              await c.query(
                "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,metadata_json) VALUES($1,$2,'review.submitted','customer_review',$3,$4,$5)",
                [
                  tenantId,
                  rr.branch_id,
                  id,
                  JSON.stringify({
                    aggregateId: id,
                    branchId: rr.branch_id,
                    refetch: true,
                  }),
                  JSON.stringify({ schemaVersion: 1, pii: false }),
                ],
              );
              return { id, status: "VERIFIED", recoveryCaseId };
            },
          })
        ).data,
    );
  }

  cases(auth: AccessClaims) {
    this.core.access(auth);
    const ownOnly =
      auth.roles.includes("NAIL_TECHNICIAN") &&
      !auth.roles.some((r) => ["SALON_OWNER", "BRANCH_MANAGER"].includes(r));
    return this.core.db
      .query<any>(
        `SELECT id,branch_id "branchId",customer_id "customerId",source,severity,category,summary,status,assigned_user_id "assignedUserId",first_response_due_at "firstResponseDueAt",resolution_due_at "resolutionDueAt",version,created_at "createdAt" FROM service_recovery_cases WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) AND (NOT $3::boolean OR assigned_user_id=$4) ORDER BY created_at DESC`,
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
          ownOnly,
          auth.userId,
        ],
      )
      .then((r) => r.rows);
  }
  recoveryCase(auth: AccessClaims, id: string) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        `SELECT c.*,COALESCE((SELECT json_agg(t ORDER BY t.created_at) FROM service_recovery_tasks t WHERE t.tenant_id=c.tenant_id AND t.case_id=c.id),'[]') tasks,COALESCE((SELECT json_agg(x ORDER BY x.created_at) FROM service_recovery_contacts x WHERE x.tenant_id=c.tenant_id AND x.case_id=c.id),'[]') contacts,COALESCE((SELECT json_agg(r ORDER BY r.created_at) FROM service_recovery_compensation_requests r WHERE r.tenant_id=c.tenant_id AND r.case_id=c.id),'[]') compensations FROM service_recovery_cases c WHERE c.tenant_id=$1 AND c.id=$2`,
        [auth.tenantId, id],
      )
      .then((r) => {
        const row = r.rows[0];
        if (!row) this.core.notFound("RECOVERY_CASE_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (
          auth.roles.includes("NAIL_TECHNICIAN") &&
          row.assigned_user_id !== auth.userId
        )
          this.core.notFound("RECOVERY_CASE_NOT_FOUND");
        return row;
      });
  }
  createCase(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = recoveryCaseSchema.parse(input);
    this.core.branch(auth, b.branchId);
    return this.core.command(
      auth,
      "service-recovery.case.create",
      key,
      b,
      async (c) => {
        const [first, resolution] = recoverySlaHours(b.severity);
        const timezone = (
          await c.query<any>(
            "SELECT timezone FROM branches WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, b.branchId],
          )
        ).rows[0]?.timezone;
        if (!timezone) this.core.notFound("BRANCH_NOT_FOUND");
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO service_recovery_cases(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,review_id,source,severity,category,summary,customer_statement,branch_timezone,sla_policy_version,first_response_due_at,resolution_due_at,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,now()+($14||' hours')::interval,now()+($15||' hours')::interval,$16) RETURNING *`,
            [
              id,
              auth.tenantId,
              b.branchId,
              b.customerId,
              b.appointmentId ?? null,
              b.invoiceId ?? null,
              b.reviewId ?? null,
              b.source,
              b.severity,
              b.category,
              b.summary,
              b.customerStatement ?? null,
              timezone,
              first,
              resolution,
              `manual:${key}`,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO service_recovery_history(tenant_id,case_id,to_status,actor_user_id,request_id) VALUES($1,$2,'OPEN',$3,$4)",
          [auth.tenantId, id, auth.userId, requestId],
        );
        await this.core.evidence(
          c,
          auth,
          "service_recovery.created",
          "service_recovery_case",
          id,
          requestId,
          b.branchId,
          { severity: b.severity, source: b.source },
        );
        return row;
      },
    );
  }
  transitionCase(
    auth: AccessClaims,
    id: string,
    target: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      `service-recovery.case.${target.toLowerCase()}`,
      key,
      { id, target, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM service_recovery_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("RECOVERY_CASE_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (input?.version && input.version !== row.version)
          this.core.conflict("VERSION_CONFLICT");
        assertTransition(
          recoveryTransitions,
          row.status,
          target,
          "RECOVERY_STATUS_INVALID",
        );
        if (target === "RESOLVED") {
          const pending = await c.query(
            "SELECT 1 FROM service_recovery_compensation_requests WHERE tenant_id=$1 AND case_id=$2 AND status IN('DRAFT','PENDING_APPROVAL','APPROVED')",
            [auth.tenantId, id],
          );
          if (pending.rowCount)
            this.core.conflict("RECOVERY_COMPENSATION_NOT_POSTED");
        }
        const updated = (
          await c.query<any>(
            "UPDATE service_recovery_cases SET status=$3,resolution=CASE WHEN $3='RESOLVED' THEN $4 ELSE resolution END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, target, input?.resolution ?? null],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO service_recovery_history(tenant_id,case_id,from_status,to_status,actor_user_id,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            auth.tenantId,
            id,
            row.status,
            target,
            auth.userId,
            input?.reason ?? null,
            requestId,
          ],
        );
        await this.core.evidence(
          c,
          auth,
          `service_recovery.${target.toLowerCase()}`,
          "service_recovery_case",
          id,
          requestId,
          row.branch_id,
        );
        return updated;
      },
    );
  }
  assign(
    auth: AccessClaims,
    id: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "service-recovery.case.assign",
      key,
      { id, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM service_recovery_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("RECOVERY_CASE_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        const updated = (
          await c.query<any>(
            "UPDATE service_recovery_cases SET assigned_user_id=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, input.assignedUserId],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "service_recovery.assigned",
          "service_recovery_case",
          id,
          requestId,
          row.branch_id,
          { assignedUserId: input.assignedUserId },
        );
        return updated;
      },
    );
  }
  tasks(auth: AccessClaims, caseId: string) {
    return Promise.resolve(this.recoveryCase(auth, caseId)).then(() =>
      this.core.db
        .query<any>(
          "SELECT * FROM service_recovery_tasks WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at",
          [auth.tenantId, caseId],
        )
        .then((r) => r.rows),
    );
  }
  assignedTasks(auth: AccessClaims) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        `SELECT t.id,t.case_id "caseId",t.task_type "taskType",t.status,t.due_at "dueAt",t.note,t.version,c.branch_id "branchId",c.severity,c.summary
         FROM service_recovery_tasks t
         JOIN service_recovery_cases c ON c.tenant_id=t.tenant_id AND c.id=t.case_id
         WHERE t.tenant_id=$1 AND t.assigned_user_id=$2
           AND ($3::uuid[] IS NULL OR c.branch_id=ANY($3::uuid[]))
         ORDER BY CASE t.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,t.due_at NULLS LAST,t.created_at`,
        [
          auth.tenantId,
          auth.userId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  createTask(
    auth: AccessClaims,
    caseId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "service-recovery.task.create",
      key,
      { caseId, ...input },
      async (c) => {
        const parent = (
          await c.query<any>(
            "SELECT * FROM service_recovery_cases WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, caseId],
          )
        ).rows[0];
        if (!parent) this.core.notFound("RECOVERY_CASE_NOT_FOUND");
        this.core.branch(auth, parent.branch_id);
        const id = randomUUID();
        const row = (
          await c.query<any>(
            "INSERT INTO service_recovery_tasks(id,tenant_id,case_id,task_type,assigned_user_id,due_at,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              id,
              auth.tenantId,
              caseId,
              input.taskType,
              input.assignedUserId ?? null,
              input.dueAt ?? null,
              input.note ?? null,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "service_recovery.task_created",
          "service_recovery_task",
          id,
          requestId,
          parent.branch_id,
          { caseId },
        );
        return row;
      },
    );
  }
  completeTask(
    auth: AccessClaims,
    taskId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "service-recovery.task.complete",
      key,
      { taskId, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT t.*,r.branch_id FROM service_recovery_tasks t JOIN service_recovery_cases r ON r.tenant_id=t.tenant_id AND r.id=t.case_id WHERE t.tenant_id=$1 AND t.id=$2 FOR UPDATE",
            [auth.tenantId, taskId],
          )
        ).rows[0];
        if (!row) this.core.notFound("RECOVERY_TASK_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (
          auth.roles.includes("NAIL_TECHNICIAN") &&
          row.assigned_user_id !== auth.userId
        )
          this.core.notFound("RECOVERY_TASK_NOT_FOUND");
        const updated = (
          await c.query<any>(
            "UPDATE service_recovery_tasks SET status='COMPLETED',completed_at=now(),note=COALESCE($3,note),version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, taskId, input?.note ?? null],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "service_recovery.task_completed",
          "service_recovery_task",
          taskId,
          requestId,
          row.branch_id,
        );
        return updated;
      },
    );
  }
  contact(
    auth: AccessClaims,
    caseId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "service-recovery.contact",
      key,
      { caseId, ...input },
      async (c) => {
        const parent = (
          await c.query<any>(
            "SELECT * FROM service_recovery_cases WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, caseId],
          )
        ).rows[0];
        if (!parent) this.core.notFound("RECOVERY_CASE_NOT_FOUND");
        this.core.branch(auth, parent.branch_id);
        if (
          auth.roles.includes("NAIL_TECHNICIAN") &&
          parent.assigned_user_id !== auth.userId
        )
          this.core.notFound("RECOVERY_CASE_NOT_FOUND");
        const id = randomUUID();
        const row = (
          await c.query<any>(
            "INSERT INTO service_recovery_contacts(id,tenant_id,case_id,contact_type,summary_redacted,actor_user_id,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              id,
              auth.tenantId,
              caseId,
              input.contactType,
              String(input.summary ?? "").replace(
                /[\w.+-]+@[\w.-]+/g,
                "[REDACTED_EMAIL]",
              ),
              auth.userId,
              this.core.hash(`${caseId}:${key}`),
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "service_recovery.contact_logged",
          "service_recovery_contact",
          id,
          requestId,
          parent.branch_id,
          { caseId, contactType: input.contactType },
        );
        return row;
      },
    );
  }
  compensations(auth: AccessClaims, caseId: string) {
    return Promise.resolve(this.recoveryCase(auth, caseId)).then(() =>
      this.core.db
        .query<any>(
          "SELECT * FROM service_recovery_compensation_requests WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at",
          [auth.tenantId, caseId],
        )
        .then((r) => r.rows),
    );
  }
  pendingCompensations(auth: AccessClaims) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        `SELECT r.id,r.case_id "caseId",r.branch_id "branchId",r.customer_id "customerId",r.compensation_type "compensationType",r.proposal_json "proposal",r.status,r.requested_by_user_id "requestedByUserId",r.reason,r.version,r.created_at "createdAt",c.summary,c.severity
         FROM service_recovery_compensation_requests r
         JOIN service_recovery_cases c ON c.tenant_id=r.tenant_id AND c.id=r.case_id
         WHERE r.tenant_id=$1 AND r.status='PENDING_APPROVAL'
           AND ($2::uuid[] IS NULL OR r.branch_id=ANY($2::uuid[]))
         ORDER BY r.created_at`,
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  requestCompensation(
    auth: AccessClaims,
    caseId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = recoveryCompensationSchema.parse(input);
    return this.core.command(
      auth,
      "service-recovery.compensation.request",
      key,
      { caseId, ...b },
      async (c) => {
        const parent = (
          await c.query<any>(
            "SELECT * FROM service_recovery_cases WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, caseId],
          )
        ).rows[0];
        if (!parent) this.core.notFound("RECOVERY_CASE_NOT_FOUND");
        this.core.branch(auth, parent.branch_id);
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO service_recovery_compensation_requests(id,tenant_id,case_id,branch_id,customer_id,compensation_type,proposal_json,status,requested_by_user_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING_APPROVAL',$8,$9) RETURNING *`,
            [
              id,
              auth.tenantId,
              caseId,
              parent.branch_id,
              parent.customer_id,
              b.compensationType,
              JSON.stringify(b.proposal),
              auth.userId,
              b.reason,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "service_recovery.compensation_requested",
          "service_recovery_compensation",
          id,
          requestId,
          parent.branch_id,
          { caseId, type: b.compensationType },
        );
        return row;
      },
    );
  }
  async decideCompensation(
    auth: AccessClaims,
    id: string,
    decision: "APPROVED" | "REJECTED" | "CANCELLED",
    input: any,
    key: string,
    requestId: string,
  ) {
    const decided = await this.core.command(
      auth,
      `service-recovery.compensation.${decision.toLowerCase()}`,
      key,
      { id, decision, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM service_recovery_compensation_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("RECOVERY_COMPENSATION_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (input?.version !== row.version)
          this.core.conflict("RECOVERY_COMPENSATION_VERSION_CONFLICT");
        if (row.status !== "PENDING_APPROVAL")
          this.core.conflict("RECOVERY_COMPENSATION_STATUS_INVALID");
        if (decision === "APPROVED" && row.requested_by_user_id === auth.userId)
          throw new ForbiddenException({
            code: "RECOVERY_COMPENSATION_SELF_APPROVAL_DENIED",
            message: "Requester cannot approve compensation",
          });
        const updated = (
          await c.query<any>(
            "UPDATE service_recovery_compensation_requests SET status=$3,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, decision, auth.userId],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          `service_recovery.compensation_${decision.toLowerCase()}`,
          "service_recovery_compensation",
          id,
          requestId,
          row.branch_id,
          { type: row.compensation_type, reason: input.reason },
        );
        return updated;
      },
    );
    if (decision !== "APPROVED") return decided;
    const proposal = decided.proposal_json as any;
    let reference: any = null;
    try {
      if (decided.compensation_type === "CUSTOMER_CREDIT")
        reference = await this.storedValue.createAdjustment(
          auth,
          {
            branchId: decided.branch_id,
            customerId: decided.customer_id,
            currency: proposal.currency ?? "VND",
            adjustmentType: "SERVICE_RECOVERY_CREDIT",
            amountMinor: String(proposal.amountMinor),
            reasonCode: "SERVICE_RECOVERY",
            note: decided.reason,
          },
          `${key}:customer-credit`,
          requestId,
        );
      else if (decided.compensation_type === "LOYALTY_POINTS")
        reference = await this.benefits.createAdjustment(
          auth,
          {
            customerId: decided.customer_id,
            pointsDelta: Number(proposal.pointsDelta),
            reasonCode: "SERVICE_RECOVERY",
            note: decided.reason,
          },
          `${key}:loyalty-points`,
          requestId,
        );
      else if (decided.compensation_type === "VOUCHER")
        reference = await this.benefits.issueCode(
          auth,
          String(proposal.campaignId),
          {
            code: String(proposal.code),
            customerId: decided.customer_id,
            useLimit: Number(proposal.useLimit ?? 1),
            expiresAt: proposal.expiresAt ?? undefined,
          },
          `${key}:voucher-code`,
          requestId,
        );
      else reference = { id: randomUUID(), foundationOnly: true };
    } catch (error: any) {
      const safeCode = String(error?.response?.code ?? error?.code ?? "OWNING_DOMAIN_FAILED").slice(0, 100);
      await this.core.db.transaction(async (c) => {
        await c.query(
          `UPDATE service_recovery_compensation_requests SET status='FAILED',sync_status='FAILED',sync_error_code=$3,version=version+1,updated_at=now()
           WHERE tenant_id=$1 AND id=$2 AND status IN('APPROVED','FAILED')`,
          [auth.tenantId, id, safeCode],
        );
        await this.core.evidence(
          c,
          auth,
          "service_recovery.compensation_failed",
          "service_recovery_compensation",
          id,
          requestId,
          decided.branch_id,
          { type: decided.compensation_type, errorCode: safeCode },
        );
      });
      throw error;
    }
    const postsImmediately = [
      "VOUCHER",
      "NO_MONETARY_COMPENSATION",
      "COMPLIMENTARY_SERVICE_FOUNDATION",
    ].includes(decided.compensation_type);
    await this.core.db.transaction(async (c) => {
      await c.query(
        `UPDATE service_recovery_compensation_requests
         SET existing_domain_reference_type=$3,existing_domain_reference_id=$4,
             status=CASE WHEN $5 THEN 'POSTED' ELSE 'APPROVED' END,
             sync_status=CASE WHEN $5 THEN 'POSTED' ELSE 'PENDING' END,
             posted_at=CASE WHEN $5 THEN now() ELSE NULL END,version=version+1,updated_at=now()
         WHERE tenant_id=$1 AND id=$2`,
        [auth.tenantId, id, decided.compensation_type, reference.id, postsImmediately],
      );
      if (postsImmediately)
        await this.core.evidence(
          c,
          auth,
          "service_recovery.compensation_posted",
          "service_recovery_compensation",
          id,
          requestId,
          decided.branch_id,
          { type: decided.compensation_type, referenceId: reference.id },
        );
    });
    return {
      ...decided,
      status: postsImmediately ? "POSTED" : "APPROVED",
      sync_status: postsImmediately ? "POSTED" : "PENDING",
      existingDomainReference: {
        type: decided.compensation_type,
        id: reference.id,
      },
    };
  }
  engagementTimeline(auth: AccessClaims, customerId: string) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        `SELECT * FROM (SELECT created_at,'CONSENT' type,event_type action,resulting_state status,purpose detail,id FROM customer_consent_events WHERE tenant_id=$1 AND customer_id=$2 UNION ALL SELECT created_at,'MESSAGE',purpose,status,category,id FROM communication_messages WHERE tenant_id=$1 AND customer_id=$2 UNION ALL SELECT submitted_at,'REVIEW','SUBMITTED',status,overall_rating::text,id FROM customer_reviews WHERE tenant_id=$1 AND customer_id=$2 UNION ALL SELECT created_at,'RECOVERY',source,status,severity,id FROM service_recovery_cases WHERE tenant_id=$1 AND customer_id=$2) timeline ORDER BY created_at DESC`,
        [auth.tenantId, customerId],
      )
      .then((r) => r.rows);
  }

  async createReviewRequestForInvoice(tenantId: string, invoiceId: string) {
    return this.core.db.transaction(async (c) => {
      const row = (
        await c.query<any>(
          `SELECT i.id invoice_id,i.branch_id,o.appointment_id,o.customer_id,a.status appointment_status,o.status order_status,p.email_status,p.review_request_allowed FROM invoices i JOIN pos_orders o ON o.tenant_id=i.tenant_id AND o.id=i.pos_order_id JOIN appointments a ON a.tenant_id=o.tenant_id AND a.id=o.appointment_id JOIN customer_communication_preferences p ON p.tenant_id=o.tenant_id AND p.customer_id=o.customer_id WHERE i.tenant_id=$1 AND i.id=$2 AND i.status='ISSUED' AND i.paid_minor>=i.total_minor+i.tip_minor`,
          [tenantId, invoiceId],
        )
      ).rows[0];
      if (
        !row ||
        row.appointment_status !== "COMPLETED" ||
        row.order_status !== "PAID" ||
        row.email_status !== "VERIFIED" ||
        !row.review_request_allowed
      )
        return null;
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 14 * 86400_000);
      const token = signPublicToken(
        {
          tenantId,
          reviewRequestId: id,
          customerId: row.customer_id,
          purpose: "REVIEW",
          exp: Math.floor(expiresAt.getTime() / 1000),
        },
        this.tokenSecret(),
      );
      try {
        await c.query(
          `INSERT INTO review_requests(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,token_hash,expires_at,status,generation_key,sent_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'SENT',$9,now())`,
          [
            id,
            tenantId,
            row.branch_id,
            row.customer_id,
            row.appointment_id,
            invoiceId,
            this.tokenHash(token),
            expiresAt,
            `review:${row.appointment_id}`,
          ],
        );
      } catch (error: any) {
        if (error?.code === "23505") return null;
        throw error;
      }
      return { id, token };
    });
  }
  private async createLowRatingCase(
    c: any,
    tenantId: string,
    rr: any,
    reviewId: string,
    rating: number,
    requestId: string,
  ) {
    const branch = (
      await c.query(
        "SELECT timezone FROM branches WHERE tenant_id=$1 AND id=$2",
        [tenantId, rr.branch_id],
      )
    ).rows[0];
    const severity = rating === 1 ? "HIGH" : "MEDIUM";
    const [first, resolution] = recoverySlaHours(severity);
    const id = randomUUID();
    await c.query(
      `INSERT INTO service_recovery_cases(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,review_id,source,severity,category,summary,branch_timezone,sla_policy_version,first_response_due_at,resolution_due_at,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,'LOW_REVIEW',$8,'CUSTOMER_EXPERIENCE',$9,$10,1,now()+($11||' hours')::interval,now()+($12||' hours')::interval,$13) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
      [
        id,
        tenantId,
        rr.branch_id,
        rr.customer_id,
        rr.appointment_id,
        rr.invoice_id,
        reviewId,
        severity,
        `Verified ${rating}-star review requires recovery`,
        branch.timezone,
        first,
        resolution,
        `low-review:${reviewId}:policy:1`,
      ],
    );
    const actual = (
      await c.query(
        "SELECT id FROM service_recovery_cases WHERE tenant_id=$1 AND generation_key=$2",
        [tenantId, `low-review:${reviewId}:policy:1`],
      )
    ).rows[0]?.id;
    if (actual === id) {
      await c.query(
        "INSERT INTO service_recovery_history(tenant_id,case_id,to_status,request_id) VALUES($1,$2,'OPEN',$3)",
        [tenantId, id, requestId],
      );
      await c.query(
        "INSERT INTO internal_notifications(tenant_id,branch_id,type,title,body_redacted,entity_type,entity_id) VALUES($1,$2,'LOW_REVIEW_ALERT','Low verified review','A verified low-rating review needs triage','service_recovery_case',$3)",
        [tenantId, rr.branch_id, id],
      );
    }
    return actual ?? null;
  }
}
