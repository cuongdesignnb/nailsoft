/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";
@Injectable()
export class WorkforceProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 2,
  });
  async run() {
    const values = await Promise.all([
      this.monitorOpenSessions(),
      this.detectAttendanceExceptions(),
      this.processPayouts(),
      this.reconcilePayouts(),
      this.claimExport(),
    ]);
    return values.reduce((a, b) => a + b, 0);
  }
  async monitorOpenSessions() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = (
        await client.query<any>(
          `SELECT s.*,p.maximum_session_minutes FROM attendance_sessions s JOIN time_clock_policies p ON p.tenant_id=s.tenant_id AND (p.branch_id=s.branch_id OR p.branch_id IS NULL) WHERE s.state='OPEN' AND p.status='ACTIVE' AND p.maximum_session_minutes IS NOT NULL AND s.started_at<now()-(p.maximum_session_minutes||' minutes')::interval ORDER BY s.started_at FOR UPDATE OF s SKIP LOCKED LIMIT 50`,
        )
      ).rows;
      for (const row of rows)
        await client.query(
          `INSERT INTO attendance_exceptions(tenant_id,branch_id,staff_id,session_id,exception_type,severity,evidence_json,generation_key) VALUES($1,$2,$3,$4,'EXCESSIVE_SESSION_DURATION','BLOCKING',jsonb_build_object('detectedAt',now()),$5) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
          [
            row.tenant_id,
            row.branch_id,
            row.staff_id,
            row.id,
            `${row.id}:EXCESSIVE_SESSION_DURATION`,
          ],
        );
      await client.query("COMMIT");
      return rows.length;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async detectAttendanceExceptions() {
    const result = await this.pool.query(
      `INSERT INTO attendance_exceptions(tenant_id,branch_id,staff_id,session_id,exception_type,severity,evidence_json,generation_key) SELECT s.tenant_id,s.branch_id,s.staff_id,s.id,'MISSED_CLOCK_OUT','WARNING',jsonb_build_object('detectedAt',now()),s.id||':MISSED_CLOCK_OUT' FROM attendance_sessions s WHERE s.state='OPEN' AND s.started_at<now()-interval '20 hours' ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
    );
    return result.rowCount ?? 0;
  }
  async reconcilePayouts() {
    const result = await this.pool.query(
      `INSERT INTO payout_reconciliations(tenant_id,payout_item_id,state,expected_minor,confirmed_minor,reversed_minor,currency,external_reference) SELECT tenant_id,id,CASE WHEN state='PAID' AND confirmed_minor=requested_minor THEN 'MATCHED' ELSE 'UNMATCHED' END,requested_minor,COALESCE(confirmed_minor,0),0,currency,provider_reference FROM payout_items WHERE state IN('PAID','REVERSED') ON CONFLICT(tenant_id,payout_item_id) DO UPDATE SET state=EXCLUDED.state,confirmed_minor=EXCLUDED.confirmed_minor,external_reference=EXCLUDED.external_reference,updated_at=now()`,
    );
    return result.rowCount ?? 0;
  }
  async processPayouts() {
    await this.recoverUnknownPayouts();
    const reconciled = await this.reconcileUnknownPayout();
    if (reconciled) return reconciled;
    const claim = await this.claimPayout();
    if (!claim) return 0;
    let result:
      | { ok: true; reference: string }
      | { ok: false; code: string }
      | { ok: null; code: string };
    try {
      result = await this.submitPayout(claim);
    } catch {
      result = { ok: null, code: "PROVIDER_RESULT_UNKNOWN" };
    }
    await this.finishPayout(claim, result);
    return 1;
  }
  private async claimPayout() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query<any>(
          `SELECT i.*,b.provider_code,b.method,b.id batch_id_value
           FROM payout_items i JOIN payout_batches b ON b.tenant_id=i.tenant_id AND b.id=i.batch_id
           WHERE i.state='PROCESSING' AND b.state='PROCESSING' AND b.method='EXTERNAL_PAYROLL_PROVIDER'
             AND NOT EXISTS(SELECT 1 FROM payout_attempts a WHERE a.tenant_id=i.tenant_id AND a.payout_item_id=i.id AND a.state IN('PENDING','SUBMITTED','UNKNOWN'))
             AND COALESCE((SELECT max(a.next_retry_at) FROM payout_attempts a WHERE a.tenant_id=i.tenant_id AND a.payout_item_id=i.id AND a.state='FAILED'),'-infinity'::timestamptz)<=now()
           ORDER BY i.created_at FOR UPDATE OF i SKIP LOCKED LIMIT 1`,
        )
      ).rows[0]!;
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      // The row lock may have waited for another claimant. Re-check attempts in
      // a fresh READ COMMITTED statement so a concurrent provider intent that
      // committed while we waited cannot be duplicated.
      const attemptState = (
        await client.query<{ active: boolean; next_attempt_no: number }>(
          `SELECT EXISTS(
             SELECT 1 FROM payout_attempts
             WHERE tenant_id=$1 AND payout_item_id=$2 AND state IN('PENDING','SUBMITTED','UNKNOWN')
           ) active,
           COALESCE(max(attempt_no),0)::int+1 next_attempt_no
           FROM payout_attempts WHERE tenant_id=$1 AND payout_item_id=$2`,
          [row.tenant_id, row.id],
        )
      ).rows[0]!;
      if (attemptState.active) {
        await client.query("COMMIT");
        return null;
      }
      const requestKey = row.provider_request_key;
      const attempt = (
        await client.query<any>(
          `INSERT INTO payout_attempts(tenant_id,payout_item_id,attempt_no,state,provider_request_key,safe_request_json)
           VALUES($1::uuid,$2::uuid,$3::integer,'SUBMITTED',$4::text,jsonb_build_object('payoutItemId',$2::uuid,'amountMinor',$5::bigint,'currency',$6::char(3))) RETURNING *`,
          [
            row.tenant_id,
            row.id,
            attemptState.next_attempt_no,
            requestKey,
            row.requested_minor,
            row.currency,
          ],
        )
      ).rows[0];
      await client.query("COMMIT");
      return {
        ...row,
        attempt_no: attemptState.next_attempt_no,
        attemptId: attempt.id,
        requestKey,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async submitPayout(
    claim: any,
  ): Promise<
    | { ok: true; reference: string }
    | { ok: false; code: string }
    | { ok: null; code: string }
  > {
    if (
      process.env.PAYOUT_PROVIDER_MODE === "FAKE" &&
      process.env.NODE_ENV !== "production"
    ) {
      if (process.env.PAYOUT_FAKE_RESULT === "FAILED")
        return { ok: false as const, code: "FAKE_PROVIDER_DECLINED" };
      if (process.env.PAYOUT_FAKE_RESULT === "LOST_RESPONSE")
        throw new Error("simulated response loss after provider acceptance");
      if (process.env.PAYOUT_FAKE_RESULT === "UNKNOWN")
        return { ok: null, code: "PROVIDER_RESULT_UNKNOWN" };
      return {
        ok: true as const,
        reference: `FAKE-${claim.id}-${claim.attempt_no}`,
      };
    }
    return { ok: false as const, code: "PAYOUT_PROVIDER_NOT_CONFIGURED" };
  }
  private async finishPayout(
    claim: any,
    result:
      | { ok: true; reference: string }
      | { ok: false; code: string }
      | { ok: null; code: string },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = (
        await client.query<any>(
          "SELECT * FROM payout_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [claim.tenant_id, claim.id],
        )
      ).rows[0];
      if (!current || current.state !== "PROCESSING") {
        await client.query("ROLLBACK");
        return;
      }
      if (result.ok === true) {
        await client.query(
          `UPDATE payout_attempts SET state='CONFIRMED',provider_reference=$3,safe_response_json=jsonb_build_object('confirmed',true),completed_at=now()
           WHERE tenant_id=$1 AND id=$2 AND state='SUBMITTED'`,
          [claim.tenant_id, claim.attemptId, result.reference],
        );
        await client.query(
          `UPDATE payout_items SET state='PAID',confirmed_minor=requested_minor,provider_reference=$3,paid_at=now(),failure_code=NULL,version=version+1,updated_at=now()
           WHERE tenant_id=$1 AND id=$2`,
          [claim.tenant_id, claim.id, result.reference],
        );
        await client.query(
          "UPDATE pay_statements SET payment_status='PAID' WHERE tenant_id=$1 AND id=$2",
          [claim.tenant_id, current.pay_statement_id],
        );
      } else if (result.ok === false) {
        const terminal = Number(claim.attempt_no) >= 3;
        await client.query(
          `UPDATE payout_attempts SET state='FAILED',error_code=$3,next_retry_at=CASE WHEN $4 THEN NULL ELSE now()+($5||' seconds')::interval END,completed_at=now()
           WHERE tenant_id=$1 AND id=$2 AND state='SUBMITTED'`,
          [
            claim.tenant_id,
            claim.attemptId,
            result.code,
            terminal,
            Math.min(60, Number(claim.attempt_no) * 5),
          ],
        );
        if (terminal)
          await client.query(
            "UPDATE payout_items SET state='FAILED',failure_code=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [claim.tenant_id, claim.id, result.code],
          );
      } else {
        await client.query(
          `UPDATE payout_attempts SET state='UNKNOWN',error_code=$3,safe_response_json=jsonb_build_object('outcome','UNKNOWN'),completed_at=now()
           WHERE tenant_id=$1 AND id=$2 AND state='SUBMITTED'`,
          [claim.tenant_id, claim.attemptId, result.code],
        );
        await client.query(
          `UPDATE payout_items SET state='UNKNOWN',unknown_since=now(),failure_code=$3,lease_expires_at=NULL,
             version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [claim.tenant_id, claim.id, result.code],
        );
      }
      await client.query(
        `UPDATE payout_batches b SET state=CASE
          WHEN NOT EXISTS(SELECT 1 FROM payout_items i WHERE i.tenant_id=b.tenant_id AND i.batch_id=b.id AND i.state<>'PAID') THEN 'PAID'
          WHEN EXISTS(SELECT 1 FROM payout_items i WHERE i.tenant_id=b.tenant_id AND i.batch_id=b.id AND i.state='PAID') THEN 'PARTIALLY_PAID'
          WHEN EXISTS(SELECT 1 FROM payout_items i WHERE i.tenant_id=b.tenant_id AND i.batch_id=b.id AND i.state='FAILED') THEN 'FAILED'
          ELSE b.state END,version=version+1,updated_at=now()
         WHERE b.tenant_id=$1 AND b.id=$2`,
        [claim.tenant_id, claim.batch_id],
      );
      await client.query(
        `INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json)
         VALUES($1::uuid,$2::text,'payout_item',$3::uuid,jsonb_build_object('id',$3::uuid,'refetch',true),'{"type":"SYSTEM"}','{"schemaVersion":1}')`,
        [
          claim.tenant_id,
          result.ok === true
            ? "payout.item_paid"
            : result.ok === false
              ? "payout.item_failed"
              : "payout.item_unknown",
          claim.id,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async recoverUnknownPayouts() {
    const result = await this.pool.query(
      `WITH stale AS (
         UPDATE payout_attempts SET state='UNKNOWN',error_code='PROVIDER_RESULT_UNKNOWN',completed_at=now()
         WHERE state='SUBMITTED' AND started_at<now()-interval '5 minutes' RETURNING tenant_id,payout_item_id
       ) UPDATE payout_items i SET state='UNKNOWN',unknown_since=now(),failure_code='PROVIDER_RESULT_UNKNOWN',version=version+1,updated_at=now()
         FROM stale s WHERE i.tenant_id=s.tenant_id AND i.id=s.payout_item_id AND i.state='PROCESSING'`,
    );
    return result.rowCount ?? 0;
  }
  private async reconcileUnknownPayout() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const item = (
        await client.query<any>(
          `SELECT i.*,b.provider_code FROM payout_items i
           JOIN payout_batches b ON b.tenant_id=i.tenant_id AND b.id=i.batch_id
           WHERE i.state='UNKNOWN' ORDER BY i.unknown_since FOR UPDATE OF i SKIP LOCKED LIMIT 1`,
        )
      ).rows[0];
      if (!item) {
        await client.query("COMMIT");
        return 0;
      }
      const fake =
        process.env.PAYOUT_PROVIDER_MODE === "FAKE" &&
        process.env.NODE_ENV !== "production";
      const outcome =
        fake && process.env.PAYOUT_FAKE_RESULT === "LOST_RESPONSE"
          ? "CONFIRMED"
          : fake && process.env.PAYOUT_FAKE_RECONCILE_RESULT === "FAILED"
            ? "FAILED"
            : "MANUAL_REVIEW";
      if (outcome === "CONFIRMED") {
        const reference = `FAKE-${item.id}-STABLE`;
        await client.query(
          `UPDATE payout_attempts SET state='CONFIRMED',provider_reference=$3,
             safe_response_json=jsonb_build_object('reconciled',true),completed_at=now()
           WHERE tenant_id=$1 AND payout_item_id=$2 AND state='UNKNOWN'`,
          [item.tenant_id, item.id, reference],
        );
        await client.query(
          `UPDATE payout_items SET state='PAID',confirmed_minor=requested_minor,provider_reference=$3,
             paid_at=now(),failure_code=NULL,unknown_since=NULL,version=version+1,updated_at=now()
           WHERE tenant_id=$1 AND id=$2`,
          [item.tenant_id, item.id, reference],
        );
        await client.query(
          "UPDATE pay_statements SET payment_status='PAID' WHERE tenant_id=$1 AND id=$2",
          [item.tenant_id, item.pay_statement_id],
        );
      } else if (outcome === "FAILED") {
        await client.query(
          "UPDATE payout_attempts SET state='FAILED',error_code='PROVIDER_CONFIRMED_FAILED',completed_at=now() WHERE tenant_id=$1 AND payout_item_id=$2 AND state='UNKNOWN'",
          [item.tenant_id, item.id],
        );
        await client.query(
          "UPDATE payout_items SET state='FAILED',failure_code='PROVIDER_CONFIRMED_FAILED',unknown_since=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [item.tenant_id, item.id],
        );
      } else {
        await client.query(
          "UPDATE payout_items SET state='MANUAL_REVIEW',failure_code='PROVIDER_OUTCOME_REQUIRES_REVIEW',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [item.tenant_id, item.id],
        );
      }
      await client.query("COMMIT");
      return 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async claimExport() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query<any>(
          `SELECT * FROM payroll_export_jobs WHERE state='PENDING' AND attempts<5 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        )
      ).rows[0];
      if (!row) {
        await client.query("COMMIT");
        return 0;
      }
      await client.query(
        `UPDATE payroll_export_jobs SET state='PROCESSING',attempts=attempts+1 WHERE tenant_id=$1 AND id=$2`,
        [row.tenant_id, row.id],
      );
      await client.query(
        `UPDATE payroll_export_jobs SET state='READY',storage_key=$3,checksum=encode(digest($4,'sha256'),'hex'),completed_at=now() WHERE tenant_id=$1 AND id=$2`,
        [
          row.tenant_id,
          row.id,
          `private/${row.tenant_id}/payroll-exports/${row.id}.csv`,
          `sprint12:${row.id}`,
        ],
      );
      await client.query("COMMIT");
      return 1;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
