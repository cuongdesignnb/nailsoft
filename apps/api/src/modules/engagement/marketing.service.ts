/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  customerSegmentSchema,
  marketingCampaignDirectoryQuerySchema,
  marketingCampaignSchema,
  marketingCampaignTypes,
  marketingOverviewQuerySchema,
  marketingRiskLevels,
} from "@nailsoft/validation";
import type { AccessClaims } from "../identity/auth.types.js";
import { CommunicationService } from "./communication.service.js";
import { assertTransition, campaignTransitions } from "./engagement-domain.js";

@Injectable()
export class MarketingService {
  constructor(
    @Inject(CommunicationService) readonly core: CommunicationService,
  ) {}
  segments(auth: AccessClaims) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        "SELECT * FROM customer_segments WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) ORDER BY created_at DESC",
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  segment(auth: AccessClaims, id: string) {
    return this.core.db
      .query<any>(
        "SELECT * FROM customer_segments WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
      .then((r) => {
        const row = r.rows[0];
        if (!row) this.core.notFound("SEGMENT_NOT_FOUND");
        this.assertMarketingScope(auth, row.branch_id);
        return row;
      });
  }
  createSegment(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = customerSegmentSchema.parse(input);
    this.assertMarketingScope(auth, b.branchId ?? null);
    this.assertSafeFilters(b.filters);
    this.assertFilterScope(auth, b.branchId ?? null, b.filters);
    return this.core.command(
      auth,
      "marketing.segment.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        const row = (
          await c.query<any>(
            "INSERT INTO customer_segments(id,tenant_id,branch_id,name,filter_json,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              id,
              auth.tenantId,
              b.branchId ?? null,
              b.name,
              JSON.stringify(b.filters),
              auth.userId,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "marketing.segment_created",
          "customer_segment",
          id,
          requestId,
          b.branchId,
        );
        return row;
      },
    );
  }
  updateSegment(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const raw = input as any;
    this.assertSafeFilters(raw.filters ?? {});
    return this.core.command(
      auth,
      "marketing.segment.update",
      key,
      { id, ...raw },
      async (c) => {
        const current = (
          await c.query<any>(
            "SELECT * FROM customer_segments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!current) this.core.notFound("SEGMENT_NOT_FOUND");
        this.assertMarketingScope(auth, current.branch_id);
        this.assertFilterScope(auth, current.branch_id, raw.filters ?? {});
        if (raw.version && current.version !== raw.version)
          this.core.conflict("VERSION_CONFLICT");
        const row = (
          await c.query<any>(
            "UPDATE customer_segments SET name=COALESCE($3,name),filter_json=COALESCE($4,filter_json),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [
              auth.tenantId,
              id,
              raw.name ?? null,
              raw.filters ? JSON.stringify(raw.filters) : null,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "marketing.segment_updated",
          "customer_segment",
          id,
          requestId,
          current.branch_id,
        );
        return row;
      },
    );
  }
  segmentStatus(
    auth: AccessClaims,
    id: string,
    status: "ACTIVE" | "INACTIVE",
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      `marketing.segment.${status.toLowerCase()}`,
      key,
      { id },
      async (c) => {
        const row = (
          await c.query<any>(
            "UPDATE customer_segments SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, status],
          )
        ).rows[0];
        if (!row) this.core.notFound("SEGMENT_NOT_FOUND");
        this.assertMarketingScope(auth, row.branch_id);
        await this.core.evidence(
          c,
          auth,
          "marketing.segment_status_changed",
          "customer_segment",
          id,
          requestId,
          row.branch_id,
          { status },
        );
        return row;
      },
    );
  }
  async previewSegment(auth: AccessClaims, id: string) {
    const segment = await this.segment(auth, id);
    this.assertFilterScope(auth, segment.branch_id, segment.filter_json);
    const audience = await this.eligibleCustomers(
      auth,
      segment.branch_id,
      segment.filter_json,
      20,
    );
    return {
      count: Number(
        (
          await this.core.db.query<any>(
            this.eligibleCountSql(),
            this.eligibleParams(auth, segment.branch_id, segment.filter_json),
          )
        ).rows[0].count,
      ),
      sample: audience.map((x: any) => ({
        customerId: x.customer_id,
        displayName: this.redact(x.display_name),
        locale: x.preferred_locale,
        contactable: true,
      })),
      redacted: true,
    };
  }

  campaigns(auth: AccessClaims) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        "SELECT * FROM marketing_campaigns WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) ORDER BY created_at DESC",
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  async campaignCreateContext(auth: AccessClaims) {
    this.core.access(auth);
    const settings = (
      await this.core.db.query<any>(
        "SELECT campaign_dual_control_threshold,campaign_audience_limit FROM communication_settings WHERE tenant_id=$1",
        [auth.tenantId],
      )
    ).rows[0];
    return {
      channel: "EMAIL",
      campaignTypes: [...marketingCampaignTypes],
      riskLevels: [...marketingRiskLevels],
      settings: {
        dualControlThreshold: Number(settings?.campaign_dual_control_threshold ?? 0),
        audienceLimit: Number(settings?.campaign_audience_limit ?? 100000),
      },
      tenantWideAllowed: auth.roles.includes("SALON_OWNER"),
    };
  }
  async campaignDirectory(auth: AccessClaims, input: unknown) {
    const query = marketingCampaignDirectoryQuerySchema.parse(input ?? {});
    this.core.access(auth);
    if (query.branchId) this.core.branch(auth, query.branchId);
    const branchScope = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const search = query.search ? `%${query.search}%` : null;
    const params: any[] = [
      auth.tenantId,
      branchScope,
      query.branchId ?? null,
      search,
      query.status ?? null,
      query.campaignType ?? null,
      query.riskLevel ?? null,
      query.segmentId ?? null,
      query.from ?? null,
      query.to ?? null,
    ];
    const where = `c.tenant_id=$1
      AND ($2::uuid[] IS NULL OR c.branch_id=ANY($2::uuid[]))
      AND ($3::uuid IS NULL OR c.branch_id=$3)
      AND ($4::text IS NULL OR c.name ILIKE $4 OR s.name ILIKE $4 OR t.code ILIKE $4)
      AND ($5::text IS NULL OR c.status=$5)
      AND ($6::text IS NULL OR c.campaign_type=$6)
      AND ($7::text IS NULL OR c.risk_level=$7)
      AND ($8::uuid IS NULL OR c.segment_id=$8)
      AND ($9::date IS NULL OR c.created_at >= $9::date)
      AND ($10::date IS NULL OR c.created_at < ($10::date + interval '1 day'))`;
    const orderBy: Record<string, string> = {
      NEWEST: "c.created_at DESC, c.id DESC",
      OLDEST: "c.created_at ASC, c.id ASC",
      SCHEDULE_ASC: "c.scheduled_at ASC NULLS LAST, c.created_at DESC",
      AUDIENCE_DESC: "COALESCE(a.snapshot_count,0) DESC, c.created_at DESC",
      SENT_DESC: "COALESCE(d.sent_count,0) DESC, c.created_at DESC",
    };
    const rowsResult = await this.core.db.query<any>(
      `WITH audience AS (
         SELECT tenant_id,campaign_id,generation,
           count(*)::int snapshot_count,
           count(*) FILTER (WHERE status='ELIGIBLE')::int eligible_count,
           count(*) FILTER (WHERE status='SENT')::int sent_count,
           count(*) FILTER (WHERE status='SUPPRESSED')::int suppressed_count,
           count(*) FILTER (WHERE status='FAILED')::int failed_count,
           count(*) FILTER (WHERE status='CANCELLED')::int cancelled_count
         FROM marketing_campaign_audience
         GROUP BY tenant_id,campaign_id,generation
       ), delivery AS (
         SELECT tenant_id,marketing_campaign_id,
           count(*) FILTER (WHERE status='SENT')::int sent_count,
           count(*) FILTER (WHERE status='SUPPRESSED')::int suppressed_count,
           count(*) FILTER (WHERE status IN ('FAILED','DEAD_LETTER'))::int failed_count,
           count(*) FILTER (WHERE status='CANCELLED')::int cancelled_count,
           count(*) FILTER (WHERE status IN ('PENDING','SCHEDULED','PROCESSING'))::int pending_count
         FROM communication_messages
         WHERE category='MARKETING' AND marketing_campaign_id IS NOT NULL
         GROUP BY tenant_id,marketing_campaign_id
       )
       SELECT c.id,c.name,c.campaign_type "campaignType",c.risk_level "riskLevel",c.status,
         c.branch_id "branchId",b.name "branchName",c.segment_id "segmentId",s.name "segmentName",s.version "segmentVersion",
         c.template_version_id "templateVersionId",tv.template_id "templateId",t.code "templateCode",tv.locale "templateLocale",tv.subject "templateSubject",
         c.requested_by_user_id "requestedById",requested.display_name "requestedByName",
         c.approved_by_user_id "approvedById",approved.display_name "approvedByName",
         c.audience_generation "audienceGeneration",c.version,c.scheduled_at "scheduledAt",c.started_at "startedAt",c.completed_at "completedAt",c.failure_code "failureCode",
         COALESCE(a.snapshot_count,0)::int "snapshotCount",COALESCE(a.eligible_count,0)::int "eligibleCount",COALESCE(a.sent_count,0)::int "audienceSentCount",COALESCE(a.suppressed_count,0)::int "audienceSuppressedCount",COALESCE(a.failed_count,0)::int "audienceFailedCount",COALESCE(a.cancelled_count,0)::int "audienceCancelledCount",
         COALESCE(d.sent_count,0)::int "sentCount",COALESCE(d.suppressed_count,0)::int "suppressedCount",COALESCE(d.failed_count,0)::int "failedCount",COALESCE(d.cancelled_count,0)::int "cancelledCount",COALESCE(d.pending_count,0)::int "pendingCount"
       FROM marketing_campaigns c
       LEFT JOIN branches b ON b.tenant_id=c.tenant_id AND b.id=c.branch_id
       LEFT JOIN customer_segments s ON s.tenant_id=c.tenant_id AND s.id=c.segment_id
       LEFT JOIN communication_template_versions tv ON tv.tenant_id=c.tenant_id AND tv.id=c.template_version_id
       LEFT JOIN communication_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
       LEFT JOIN users requested ON requested.id=c.requested_by_user_id AND EXISTS (SELECT 1 FROM tenant_memberships requested_membership WHERE requested_membership.tenant_id=c.tenant_id AND requested_membership.user_id=requested.id AND requested_membership.status='ACTIVE')
       LEFT JOIN users approved ON approved.id=c.approved_by_user_id AND EXISTS (SELECT 1 FROM tenant_memberships approved_membership WHERE approved_membership.tenant_id=c.tenant_id AND approved_membership.user_id=approved.id AND approved_membership.status='ACTIVE')
       LEFT JOIN audience a ON a.tenant_id=c.tenant_id AND a.campaign_id=c.id AND a.generation=c.audience_generation
       LEFT JOIN delivery d ON d.tenant_id=c.tenant_id AND d.marketing_campaign_id=c.id
       WHERE ${where}
       ORDER BY ${orderBy[query.sort]}
       LIMIT $11 OFFSET $12`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const summary = (
      await this.core.db.query<any>(
        `WITH filtered AS (
           SELECT c.id,c.status,c.audience_generation
           FROM marketing_campaigns c
           LEFT JOIN customer_segments s ON s.tenant_id=c.tenant_id AND s.id=c.segment_id
           LEFT JOIN communication_template_versions tv ON tv.tenant_id=c.tenant_id AND tv.id=c.template_version_id
           LEFT JOIN communication_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
           WHERE ${where}
         ), audience AS (
           SELECT a.* FROM marketing_campaign_audience a JOIN filtered f ON f.id=a.campaign_id AND f.audience_generation=a.generation
         ), delivery AS (
           SELECT m.* FROM communication_messages m JOIN filtered f ON f.id=m.marketing_campaign_id WHERE m.category='MARKETING'
         )
         SELECT
           (SELECT count(*)::int FROM filtered) "campaignCount",
           (SELECT count(*)::int FROM filtered WHERE status='DRAFT') "draftCount",
           (SELECT count(*)::int FROM filtered WHERE status='PENDING_APPROVAL') "pendingApprovalCount",
           (SELECT count(*)::int FROM filtered WHERE status='APPROVED') "approvedCount",
           (SELECT count(*)::int FROM filtered WHERE status='SCHEDULED') "scheduledCount",
           (SELECT count(*)::int FROM filtered WHERE status='RUNNING') "runningCount",
           (SELECT count(*)::int FROM filtered WHERE status='PAUSED') "pausedCount",
           (SELECT count(*)::int FROM filtered WHERE status='COMPLETED') "completedCount",
           (SELECT count(*)::int FROM filtered WHERE status='FAILED') "failedCampaignCount",
           (SELECT count(*)::int FROM filtered WHERE status='CANCELLED') "cancelledCount",
           (SELECT count(*)::int FROM audience) "audienceSnapshotCount",
           (SELECT count(*)::int FROM audience WHERE status='ELIGIBLE') "audienceEligibleCount",
           (SELECT count(*)::int FROM audience WHERE status='SENT') "audienceSentCount",
           (SELECT count(*)::int FROM audience WHERE status='SUPPRESSED') "audienceSuppressedCount",
           (SELECT count(*)::int FROM audience WHERE status='FAILED') "audienceFailedCount",
           (SELECT count(*)::int FROM audience WHERE status='CANCELLED') "audienceCancelledCount",
           (SELECT count(*)::int FROM delivery WHERE status='SENT') "messagesSent",
           (SELECT count(*)::int FROM delivery WHERE status='SUPPRESSED') "messagesSuppressed",
           (SELECT count(*)::int FROM delivery WHERE status IN ('FAILED','DEAD_LETTER')) "messagesFailed",
           (SELECT count(*)::int FROM delivery WHERE status='CANCELLED') "messagesCancelled",
           (SELECT count(*)::int FROM delivery WHERE status IN ('PENDING','SCHEDULED','PROCESSING')) "messagesPending"`,
        params,
      )
    ).rows[0] ?? {};
    const total = Number(summary.campaignCount ?? 0);
    return {
      items: rowsResult.rows.map((row) => this.directoryItem(row)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      summary: this.directorySummary(summary),
      generatedAt: new Date().toISOString(),
    };
  }
  async marketingOverview(auth: AccessClaims, input: unknown) {
    const query = marketingOverviewQuerySchema.parse(input ?? {});
    this.core.access(auth);
    if (query.branchId) this.core.branch(auth, query.branchId);
    const branchScope = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const today = new Date();
    const defaultTo = today.toISOString().slice(0, 10);
    const defaultFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const from = query.from ?? defaultFrom;
    const to = query.to ?? defaultTo;
    const params = [auth.tenantId, branchScope, query.branchId ?? null, from, to];
    const campaignRows = (
      await this.core.db.query<any>(
        `SELECT status,count(*)::int count FROM marketing_campaigns
         WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR branch_id=$3)
           AND created_at >= $4::date AND created_at < ($5::date + interval '1 day') GROUP BY status`,
        params,
      )
    ).rows;
    const audience = (
      await this.core.db.query<any>(
        `SELECT count(*)::int "snapshotCount",count(*) FILTER (WHERE a.status='ELIGIBLE')::int "eligibleCount",count(*) FILTER (WHERE a.status='SENT')::int "sentCount",count(*) FILTER (WHERE a.status='SUPPRESSED')::int "suppressedCount",count(*) FILTER (WHERE a.status='FAILED')::int "failedCount",count(*) FILTER (WHERE a.status='CANCELLED')::int "cancelledCount",count(*) FILTER (WHERE a.status IN ('ELIGIBLE','SENT','SUPPRESSED','FAILED','CANCELLED'))::int "knownCount"
         FROM marketing_campaign_audience a JOIN marketing_campaigns c ON c.tenant_id=a.tenant_id AND c.id=a.campaign_id AND c.audience_generation=a.generation
         WHERE a.tenant_id=$1 AND ($2::uuid[] IS NULL OR c.branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR c.branch_id=$3)
           AND a.snapshotted_at >= $4::date AND a.snapshotted_at < ($5::date + interval '1 day')`,
        params,
      )
    ).rows[0] ?? {};
    const delivery = (
      await this.core.db.query<any>(
        `SELECT count(*) FILTER (WHERE m.status='SENT')::int sent,count(*) FILTER (WHERE m.status='FAILED')::int failed,count(*) FILTER (WHERE m.status='DEAD_LETTER')::int "deadLetter",count(*) FILTER (WHERE m.status='SUPPRESSED')::int suppressed,count(*) FILTER (WHERE m.status='CANCELLED')::int cancelled,count(*) FILTER (WHERE m.status IN ('PENDING','SCHEDULED','PROCESSING'))::int pending
         FROM communication_messages m JOIN marketing_campaigns c ON c.tenant_id=m.tenant_id AND c.id=m.marketing_campaign_id
         WHERE m.tenant_id=$1 AND m.category='MARKETING' AND ($2::uuid[] IS NULL OR c.branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR c.branch_id=$3)
           AND COALESCE(m.sent_at,m.created_at) >= $4::date AND COALESCE(m.sent_at,m.created_at) < ($5::date + interval '1 day')`,
        params,
      )
    ).rows[0] ?? {};
    const counts = Object.fromEntries(campaignRows.map((row) => [row.status, Number(row.count)]));
    const sent = Number(delivery.sent ?? 0);
    const failed = Number(delivery.failed ?? 0);
    const deadLetter = Number(delivery.deadLetter ?? 0);
    const denominator = sent + failed + deadLetter;
    return {
      period: { from, to },
      campaigns: {
        draft: Number(counts.DRAFT ?? 0), pendingApproval: Number(counts.PENDING_APPROVAL ?? 0), approved: Number(counts.APPROVED ?? 0), scheduled: Number(counts.SCHEDULED ?? 0), running: Number(counts.RUNNING ?? 0), paused: Number(counts.PAUSED ?? 0), completed: Number(counts.COMPLETED ?? 0), failed: Number(counts.FAILED ?? 0), cancelled: Number(counts.CANCELLED ?? 0),
      },
      audience: {
        snapshotCount: Number(audience.snapshotCount ?? 0), eligibleCount: Number(audience.eligibleCount ?? 0), sentCount: Number(audience.sentCount ?? 0), suppressedCount: Number(audience.suppressedCount ?? 0), failedCount: Number(audience.failedCount ?? 0), cancelledCount: Number(audience.cancelledCount ?? 0), pendingCount: Number(audience.eligibleCount ?? 0),
      },
      delivery: {
        sent, failed, deadLetter, suppressed: Number(delivery.suppressed ?? 0), cancelled: Number(delivery.cancelled ?? 0), pending: Number(delivery.pending ?? 0), successRate: denominator ? Math.round((sent / denominator) * 1000) / 10 : null,
      },
      channel: "EMAIL",
      capabilities: { openTracking: false, clickTracking: false, bookingAttribution: false, revenueAttribution: false },
      generatedAt: new Date().toISOString(),
    };
  }
  campaign(auth: AccessClaims, id: string) {
    return this.core.db
      .query<any>(
        "SELECT * FROM marketing_campaigns WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
      .then((r) => {
        const row = r.rows[0];
        if (!row) this.core.notFound("CAMPAIGN_NOT_FOUND");
        this.assertMarketingScope(auth, row.branch_id);
        return row;
      });
  }
  createCampaign(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = marketingCampaignSchema.parse(input);
    this.assertMarketingScope(auth, b.branchId ?? null);
    return this.core.command(
      auth,
      "marketing.campaign.create",
      key,
      b,
      async (c) => {
        const segment = (
          await c.query<any>(
            "SELECT * FROM customer_segments WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
            [auth.tenantId, b.segmentId],
          )
        ).rows[0];
        if (!segment) this.core.notFound("SEGMENT_NOT_FOUND");
        this.assertMarketingScope(auth, segment.branch_id);
        const campaignBranch = b.branchId ?? segment.branch_id ?? null;
        this.assertMarketingScope(auth, campaignBranch);
        if (segment.branch_id && campaignBranch !== segment.branch_id)
          this.core.conflict("CAMPAIGN_SEGMENT_BRANCH_MISMATCH");
        const version = await c.query(
          "SELECT 1 FROM communication_template_versions v JOIN communication_templates t ON t.tenant_id=v.tenant_id AND t.id=v.template_id WHERE v.tenant_id=$1 AND v.id=$2 AND v.status='ACTIVE' AND t.category='MARKETING'",
          [auth.tenantId, b.templateVersionId],
        );
        if (!version.rowCount) this.core.notFound("TEMPLATE_VERSION_NOT_FOUND");
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO marketing_campaigns(id,tenant_id,branch_id,segment_id,template_version_id,name,campaign_type,risk_level,requested_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              id,
              auth.tenantId,
              campaignBranch,
              b.segmentId,
              b.templateVersionId,
              b.name,
              b.campaignType,
              b.riskLevel,
              auth.userId,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "marketing.campaign_created",
          "marketing_campaign",
          id,
          requestId,
          row.branch_id,
        );
        return row;
      },
    );
  }
  updateCampaign(
    auth: AccessClaims,
    id: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "marketing.campaign.update",
      key,
      { id, ...input },
      async (c) => {
        const current = (
          await c.query<any>(
            "SELECT * FROM marketing_campaigns WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!current) this.core.notFound("CAMPAIGN_NOT_FOUND");
        this.assertMarketingScope(auth, current.branch_id);
        if (current.status !== "DRAFT")
          this.core.conflict("CAMPAIGN_STATUS_INVALID");
        if (input.version && input.version !== current.version)
          this.core.conflict("VERSION_CONFLICT");
        const row = (
          await c.query<any>(
            "UPDATE marketing_campaigns SET name=COALESCE($3,name),campaign_type=COALESCE($4,campaign_type),risk_level=COALESCE($5,risk_level),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [
              auth.tenantId,
              id,
              input.name ?? null,
              input.campaignType ?? null,
              input.riskLevel ?? null,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "marketing.campaign_updated",
          "marketing_campaign",
          id,
          requestId,
          current.branch_id,
        );
        return row;
      },
    );
  }
  async previewCampaign(auth: AccessClaims, id: string) {
    const campaign = await this.campaign(auth, id);
    const segmentPreview = await this.previewSegment(auth, campaign.segment_id);
    const settings = (
      await this.core.db.query<any>(
        "SELECT campaign_dual_control_threshold FROM communication_settings WHERE tenant_id=$1",
        [auth.tenantId],
      )
    ).rows[0];
    return {
      ...segmentPreview,
      dualControlRequired:
        segmentPreview.count >=
          Number(settings.campaign_dual_control_threshold) ||
        campaign.risk_level !== "STANDARD",
      consentMandatory: true,
      channel: "EMAIL",
    };
  }
  transition(
    auth: AccessClaims,
    id: string,
    target: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      `marketing.campaign.${target.toLowerCase()}`,
      key,
      { id, target, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM marketing_campaigns WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("CAMPAIGN_NOT_FOUND");
        this.assertMarketingScope(auth, row.branch_id);
        if (input?.version && input.version !== row.version)
          this.core.conflict("VERSION_CONFLICT");
        assertTransition(
          campaignTransitions,
          row.status,
          target,
          "CAMPAIGN_STATUS_INVALID",
        );
        if (target === "APPROVED" && row.requested_by_user_id === auth.userId)
          throw new ForbiddenException({
            code: "CAMPAIGN_SELF_APPROVAL_DENIED",
            message: "Requester cannot approve campaign",
          });
        let generation = row.audience_generation;
        if (target === "APPROVED") {
          generation += 1;
          await this.snapshotAudience(c, auth, row, generation);
        }
        let scheduledAt: Date | null = null;
        if (target === "SCHEDULED") {
          if (typeof input?.scheduledAt !== "string" || !input.scheduledAt.trim())
            this.core.conflict("CAMPAIGN_SCHEDULE_REQUIRED");
          scheduledAt = new Date(input.scheduledAt);
          if (Number.isNaN(scheduledAt.getTime()))
            this.core.conflict("CAMPAIGN_SCHEDULE_INVALID");
          if (scheduledAt.getTime() <= Date.now())
            this.core.conflict("CAMPAIGN_SCHEDULE_MUST_BE_FUTURE");
        }
        const updated = (
          await c.query<any>(
            `UPDATE marketing_campaigns SET status=$3,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,scheduled_at=CASE WHEN $3='SCHEDULED' THEN $5 ELSE scheduled_at END,started_at=CASE WHEN $3='RUNNING' THEN now() ELSE started_at END,completed_at=CASE WHEN $3='COMPLETED' THEN now() ELSE completed_at END,audience_generation=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [auth.tenantId, id, target, auth.userId, scheduledAt, generation],
          )
        ).rows[0];
        if (target === "CANCELLED") {
          await c.query(
            `UPDATE communication_messages SET status='CANCELLED',suppression_reason='CAMPAIGN_CANCELLED',claim_token=NULL,claim_expires_at=NULL,version=version+1,updated_at=now()
             WHERE tenant_id=$1 AND marketing_campaign_id=$2 AND status IN('PENDING','SCHEDULED','FAILED','PROCESSING')`,
            [auth.tenantId, id],
          );
          await c.query(
            `UPDATE marketing_frequency_reservations r SET status='RELEASED',released_at=now()
             FROM communication_messages m WHERE r.tenant_id=$1 AND m.tenant_id=r.tenant_id AND m.id=r.message_id
             AND m.marketing_campaign_id=$2 AND r.status='ACTIVE'`,
            [auth.tenantId, id],
          );
          await c.query(
            `UPDATE marketing_campaign_audience SET status='CANCELLED',skipped_reason='CAMPAIGN_CANCELLED'
             WHERE tenant_id=$1 AND campaign_id=$2 AND generation=$3 AND status='ELIGIBLE'`,
            [auth.tenantId, id, generation],
          );
        }
        await this.core.evidence(
          c,
          auth,
          `marketing.campaign_${target.toLowerCase()}`,
          "marketing_campaign",
          id,
          requestId,
          row.branch_id,
          { generation },
        );
        return updated;
      },
    );
  }
  audience(auth: AccessClaims, id: string) {
    return Promise.resolve(this.campaign(auth, id)).then(() =>
      this.core.db
        .query<any>(
          `SELECT customer_id "customerId",locale,timezone,status,skipped_reason "skippedReason",snapshotted_at "snapshottedAt" FROM marketing_campaign_audience WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY snapshotted_at,id`,
          [auth.tenantId, id],
        )
        .then((r) => r.rows),
    );
  }
  async report(auth: AccessClaims, id: string) {
    await this.campaign(auth, id);
    const rows = (
      await this.core.db.query<any>(
        "SELECT status,count(*)::int count FROM marketing_campaign_audience WHERE tenant_id=$1 AND campaign_id=$2 GROUP BY status",
        [auth.tenantId, id],
      )
    ).rows;
    return {
      campaignId: id,
      counts: Object.fromEntries(rows.map((r: any) => [r.status, r.count])),
      generatedAt: new Date().toISOString(),
    };
  }
  async campaignOverview(auth: AccessClaims, id: string) {
    const campaign = await this.campaign(auth, id);
    const detail = (
      await this.core.db.query<any>(
        `SELECT c.id,c.name,c.campaign_type "campaignType",c.risk_level "riskLevel",c.status,c.branch_id "branchId",b.name "branchName",c.segment_id "segmentId",s.name "segmentName",s.version "segmentVersion",c.template_version_id "templateVersionId",tv.template_id "templateId",t.code "templateCode",tv.locale "templateLocale",tv.subject "templateSubject",tv.plain_text_body "templateText",c.requested_by_user_id "requestedById",requested.display_name "requestedByName",c.approved_by_user_id "approvedById",approved.display_name "approvedByName",c.audience_generation "audienceGeneration",c.version,c.scheduled_at "scheduledAt",c.started_at "startedAt",c.completed_at "completedAt",c.failure_code "failureCode",c.created_at "createdAt",c.updated_at "updatedAt"
         FROM marketing_campaigns c
         LEFT JOIN branches b ON b.tenant_id=c.tenant_id AND b.id=c.branch_id
         LEFT JOIN customer_segments s ON s.tenant_id=c.tenant_id AND s.id=c.segment_id
         LEFT JOIN communication_template_versions tv ON tv.tenant_id=c.tenant_id AND tv.id=c.template_version_id
         LEFT JOIN communication_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
         LEFT JOIN users requested ON requested.id=c.requested_by_user_id AND EXISTS (SELECT 1 FROM tenant_memberships requested_membership WHERE requested_membership.tenant_id=c.tenant_id AND requested_membership.user_id=requested.id AND requested_membership.status='ACTIVE')
         LEFT JOIN users approved ON approved.id=c.approved_by_user_id AND EXISTS (SELECT 1 FROM tenant_memberships approved_membership WHERE approved_membership.tenant_id=c.tenant_id AND approved_membership.user_id=approved.id AND approved_membership.status='ACTIVE')
         WHERE c.tenant_id=$1 AND c.id=$2`,
        [auth.tenantId, id],
      )
    ).rows[0] ?? {};
    const audienceRows = (
      await this.core.db.query<any>(
        `SELECT status,count(*)::int count FROM marketing_campaign_audience WHERE tenant_id=$1 AND campaign_id=$2 AND generation=$3 GROUP BY status`,
        [auth.tenantId, id, campaign.audience_generation],
      )
    ).rows;
    const skipRows = (
      await this.core.db.query<any>(
        `SELECT skipped_reason "reason",count(*)::int count FROM marketing_campaign_audience WHERE tenant_id=$1 AND campaign_id=$2 AND generation=$3 AND skipped_reason IS NOT NULL GROUP BY skipped_reason ORDER BY count DESC`,
        [auth.tenantId, id, campaign.audience_generation],
      )
    ).rows;
    const messageRows = (
      await this.core.db.query<any>(
        `SELECT status,count(*)::int count FROM communication_messages WHERE tenant_id=$1 AND marketing_campaign_id=$2 AND category='MARKETING' GROUP BY status`,
        [auth.tenantId, id],
      )
    ).rows;
    const audienceCounts = Object.fromEntries(audienceRows.map((row) => [row.status, Number(row.count)]));
    const messageCounts = Object.fromEntries(messageRows.map((row) => [row.status, Number(row.count)]));
    const skipReasons = Object.fromEntries(skipRows.map((row) => [row.reason, Number(row.count)]));
    const skipBy = (needle: string) => skipRows.filter((row) => String(row.reason ?? "").toUpperCase().includes(needle)).reduce((sum, row) => sum + Number(row.count), 0);
    return {
      campaign: { ...detail, id: detail.id ?? id },
      segment: detail.segmentId ? { id: detail.segmentId, name: detail.segmentName, version: detail.segmentVersion } : null,
      template: detail.templateVersionId ? { id: detail.templateId, templateVersionId: detail.templateVersionId, code: detail.templateCode, locale: detail.templateLocale, subject: detail.templateSubject, textPreview: detail.templateText } : null,
      branch: detail.branchId ? { id: detail.branchId, name: detail.branchName } : null,
      owner: detail.requestedById ? { id: detail.requestedById, displayName: detail.requestedByName } : null,
      approver: detail.approvedById ? { id: detail.approvedById, displayName: detail.approvedByName } : null,
      audience: {
        generation: Number(detail.audienceGeneration ?? campaign.audience_generation ?? 0),
        snapshotCount: Object.values(audienceCounts).reduce((sum: number, count) => sum + Number(count), 0),
        statuses: audienceCounts,
        skipReasons,
      },
      messages: {
        scheduled: Number(messageCounts.SCHEDULED ?? 0),
        processing: Number(messageCounts.PROCESSING ?? 0),
        sent: Number(messageCounts.SENT ?? 0),
        failed: Number(messageCounts.FAILED ?? 0),
        deadLetter: Number(messageCounts.DEAD_LETTER ?? 0),
        suppressed: Number(messageCounts.SUPPRESSED ?? 0),
        cancelled: Number(messageCounts.CANCELLED ?? 0),
        pending: Number(messageCounts.PENDING ?? 0),
      },
      consentSafety: {
        snapshotConsentVerified: Number(audienceCounts.ELIGIBLE ?? 0) + Number(audienceCounts.SENT ?? 0) > 0,
        suppressedForConsent: skipBy("CONSENT"),
        suppressedForInvalidEmail: skipBy("EMAIL"),
        suppressedForFrequency: skipBy("FREQUENCY"),
        suppressedForSuppression: skipBy("SUPPRESS"),
        suppressedForOther: skipRows.reduce((sum, row) => sum + Number(row.count), 0) - skipBy("CONSENT") - skipBy("EMAIL") - skipBy("FREQUENCY") - skipBy("SUPPRESS"),
      },
      capabilities: { openTracking: false, clickTracking: false, bookingAttribution: false, revenueAttribution: false },
      generatedAt: new Date().toISOString(),
    };
  }

  private directoryItem(row: any) {
    return {
      id: row.id,
      name: row.name,
      campaignType: row.campaignType,
      riskLevel: row.riskLevel,
      status: row.status,
      branch: row.branchId ? { id: row.branchId, name: row.branchName } : null,
      segment: row.segmentId ? { id: row.segmentId, name: row.segmentName, version: row.segmentVersion } : null,
      template: row.templateVersionId ? { templateId: row.templateId, templateVersionId: row.templateVersionId, code: row.templateCode, locale: row.templateLocale, subject: row.templateSubject } : null,
      audience: {
        generation: Number(row.audienceGeneration ?? 0),
        snapshotCount: Number(row.snapshotCount ?? 0),
        eligibleCount: Number(row.eligibleCount ?? 0),
        sentCount: Number(row.audienceSentCount ?? 0),
        suppressedCount: Number(row.audienceSuppressedCount ?? 0),
        failedCount: Number(row.audienceFailedCount ?? 0),
        cancelledCount: Number(row.audienceCancelledCount ?? 0),
        pendingCount: Number(row.pendingCount ?? 0),
      },
      delivery: {
        sentCount: Number(row.sentCount ?? 0),
        suppressedCount: Number(row.suppressedCount ?? 0),
        failedCount: Number(row.failedCount ?? 0),
        cancelledCount: Number(row.cancelledCount ?? 0),
        pendingCount: Number(row.pendingCount ?? 0),
      },
      requestedBy: row.requestedById ? { id: row.requestedById, displayName: row.requestedByName } : null,
      approvedBy: row.approvedById ? { id: row.approvedById, displayName: row.approvedByName } : null,
      scheduledAt: row.scheduledAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      failureCode: row.failureCode,
      version: row.version,
    };
  }

  private directorySummary(row: any) {
    return {
      campaignCount: Number(row.campaignCount ?? 0),
      draftCount: Number(row.draftCount ?? 0),
      pendingApprovalCount: Number(row.pendingApprovalCount ?? 0),
      approvedCount: Number(row.approvedCount ?? 0),
      scheduledCount: Number(row.scheduledCount ?? 0),
      runningCount: Number(row.runningCount ?? 0),
      pausedCount: Number(row.pausedCount ?? 0),
      completedCount: Number(row.completedCount ?? 0),
      failedCampaignCount: Number(row.failedCampaignCount ?? 0),
      cancelledCount: Number(row.cancelledCount ?? 0),
      audienceSnapshotCount: Number(row.audienceSnapshotCount ?? 0),
      audienceEligibleCount: Number(row.audienceEligibleCount ?? 0),
      audienceSentCount: Number(row.audienceSentCount ?? 0),
      audienceSuppressedCount: Number(row.audienceSuppressedCount ?? 0),
      audienceFailedCount: Number(row.audienceFailedCount ?? 0),
      audienceCancelledCount: Number(row.audienceCancelledCount ?? 0),
      messagesSent: Number(row.messagesSent ?? 0),
      messagesSuppressed: Number(row.messagesSuppressed ?? 0),
      messagesFailed: Number(row.messagesFailed ?? 0),
      messagesCancelled: Number(row.messagesCancelled ?? 0),
      messagesPending: Number(row.messagesPending ?? 0),
    };
  }

  private async snapshotAudience(
    c: any,
    auth: AccessClaims,
    campaign: any,
    generation: number,
  ) {
    const segment = (
      await c.query(
        "SELECT * FROM customer_segments WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, campaign.segment_id],
      )
    ).rows[0];
    const settings = (
      await c.query(
        "SELECT campaign_audience_limit FROM communication_settings WHERE tenant_id=$1",
        [auth.tenantId],
      )
    ).rows[0];
    this.assertFilterScope(auth, campaign.branch_id, segment.filter_json);
    const count = Number(
      (
        await c.query(
          this.eligibleCountSql(),
          this.eligibleParams(auth, campaign.branch_id, segment.filter_json),
        )
      ).rows[0].count,
    );
    const audienceLimit = Number(settings?.campaign_audience_limit ?? 100000);
    if (count > audienceLimit)
      this.core.conflict("CAMPAIGN_AUDIENCE_LIMIT_EXCEEDED");
    const eligible = await this.eligibleCustomers(
      auth,
      campaign.branch_id,
      segment.filter_json,
      audienceLimit,
      c,
    );
    for (const customer of eligible)
      await c.query(
        `INSERT INTO marketing_campaign_audience(tenant_id,campaign_id,customer_id,generation,consent_event_id,contact_hash,contact_reference,locale,timezone,segment_version,eligibility_snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
        [
          auth.tenantId,
          campaign.id,
          customer.customer_id,
          generation,
          customer.last_event_id,
          this.core.hash(customer.email_address),
          `preference:${customer.customer_id}`,
          customer.preferred_locale,
          customer.preferred_timezone,
          segment.version,
          JSON.stringify({
            consent: "GRANTED",
            emailStatus: "VERIFIED",
            segmentVersion: segment.version,
            branchId: campaign.branch_id,
          }),
        ],
      );
  }
  private eligibleCustomers(
    auth: AccessClaims,
    branchId: string | null,
    filters: any,
    limit: number,
    client = this.core.db,
  ) {
    const boundedLimit = Math.min(limit, 1_000_000);
    return client
      .query<any>(
        `${this.eligibleSelectSql()} LIMIT $5`,
        [...this.eligibleParams(auth, branchId, filters), boundedLimit],
      )
      .then((r: any) => r.rows);
  }
  private eligibleSelectSql() {
    return `SELECT c.id customer_id,c.display_name,p.email_address,p.preferred_locale,p.preferred_timezone,s.last_event_id FROM customers c JOIN customer_communication_preferences p ON p.tenant_id=c.tenant_id AND p.customer_id=c.id JOIN customer_consent_states s ON s.tenant_id=c.tenant_id AND s.customer_id=c.id AND s.purpose='MARKETING_EMAIL' LEFT JOIN customer_tag_assignments ta ON ta.tenant_id=c.tenant_id AND ta.customer_id=c.id WHERE c.tenant_id=$1 AND s.state='GRANTED' AND p.marketing_email_allowed AND p.email_status='VERIFIED' AND p.email_address IS NOT NULL AND NOT EXISTS(SELECT 1 FROM communication_suppressions x WHERE x.tenant_id=c.tenant_id AND x.customer_id=c.id AND x.active AND (x.purpose IS NULL OR x.purpose='MARKETING_EMAIL')) AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=c.tenant_id AND a.customer_id=c.id AND a.branch_id=$2)) AND ($3::text IS NULL OR p.preferred_locale=$3) AND ($4::uuid IS NULL OR ta.tag_id=$4) GROUP BY c.id,c.display_name,p.email_address,p.preferred_locale,p.preferred_timezone,s.last_event_id ORDER BY c.id`;
  }
  private eligibleCountSql() {
    return `SELECT count(DISTINCT c.id)::int count FROM customers c JOIN customer_communication_preferences p ON p.tenant_id=c.tenant_id AND p.customer_id=c.id JOIN customer_consent_states s ON s.tenant_id=c.tenant_id AND s.customer_id=c.id AND s.purpose='MARKETING_EMAIL' LEFT JOIN customer_tag_assignments ta ON ta.tenant_id=c.tenant_id AND ta.customer_id=c.id WHERE c.tenant_id=$1 AND s.state='GRANTED' AND p.marketing_email_allowed AND p.email_status='VERIFIED' AND p.email_address IS NOT NULL AND NOT EXISTS(SELECT 1 FROM communication_suppressions x WHERE x.tenant_id=c.tenant_id AND x.customer_id=c.id AND x.active AND (x.purpose IS NULL OR x.purpose='MARKETING_EMAIL')) AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=c.tenant_id AND a.customer_id=c.id AND a.branch_id=$2)) AND ($3::text IS NULL OR p.preferred_locale=$3) AND ($4::uuid IS NULL OR ta.tag_id=$4)`;
  }
  private eligibleParams(
    auth: AccessClaims,
    branchId: string | null,
    filters: any,
  ) {
    return [
      auth.tenantId,
      filters?.branchVisited ?? branchId,
      filters?.locale ?? null,
      filters?.tagId ?? null,
    ];
  }
  private assertSafeFilters(filters: Record<string, unknown>) {
    const allowed = new Set([
      "branchVisited",
      "locale",
      "contactable",
      "tagId",
      "marketingConsent",
    ]);
    const keys = Object.keys(filters);
    if (keys.length > 20 || keys.some((x) => !allowed.has(x)))
      this.core.conflict("SEGMENT_FILTER_NOT_SUPPORTED");
    if (filters.marketingConsent === false)
      this.core.conflict("MARKETING_CONSENT_FILTER_REQUIRED");
    if (filters.contactable === false)
      this.core.conflict("SEGMENT_FILTER_NOT_SUPPORTED");
  }
  private assertFilterScope(
    auth: AccessClaims,
    objectBranchId: string | null,
    filters: Record<string, unknown>,
  ) {
    const branchVisited = filters.branchVisited;
    if (typeof branchVisited !== "string") return;
    this.core.branch(auth, branchVisited);
    if (objectBranchId && branchVisited !== objectBranchId)
      this.core.conflict("SEGMENT_FILTER_BRANCH_MISMATCH");
  }
  private assertMarketingScope(auth: AccessClaims, branchId: string | null) {
    if (!branchId && !auth.roles.includes("SALON_OWNER"))
      throw new ForbiddenException({
        code: "TENANT_WIDE_MARKETING_OWNER_ONLY",
        message: "Tenant-wide marketing objects require Salon Owner",
      });
    this.core.branch(auth, branchId);
  }
  private redact(name: string) {
    return name ? `${name.slice(0, 1)}***` : "***";
  }
}
