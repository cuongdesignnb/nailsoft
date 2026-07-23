/* eslint-disable @typescript-eslint/no-explicit-any */
import { hostname } from "node:os";
import { createDecipheriv, createHash } from "node:crypto";
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";
import { BookingOtpProvider } from "./booking-otp.provider.js";

@Injectable()
export class BookingOtpProcessor implements OnModuleDestroy {
  private readonly workerId = `${hostname()}:${process.pid}`;
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 2,
  });

  constructor(
    @Inject(BookingOtpProvider) private readonly provider: BookingOtpProvider,
  ) {}

  async run() {
    const claimed = await this.pool.query<any>(
      `WITH candidates AS (
         SELECT id FROM booking_otp_delivery_jobs
         WHERE ((status IN ('PENDING','FAILED') AND available_at<=now() AND attempt_count<5)
           OR (status='PROCESSING' AND locked_at<now()-interval '5 minutes'))
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20
       )
       UPDATE booking_otp_delivery_jobs job
       SET status='PROCESSING',locked_at=now(),locked_by=$1,attempt_count=attempt_count+1,last_error=NULL
       FROM candidates WHERE job.id=candidates.id RETURNING job.*`,
      [this.workerId],
    );
    for (const job of claimed.rows) await this.deliver(job);
    return claimed.rowCount ?? 0;
  }

  private async deliver(job: any) {
    try {
      await this.provider.send({
        channel: job.channel,
        destination: job.destination,
        code: this.decryptOtp(job.code_ciphertext),
        purpose: job.purpose,
      });
      await this.pool.query(
        "UPDATE booking_otp_delivery_jobs SET status='DELIVERED',delivered_at=now(),locked_at=NULL,locked_by=NULL,last_error=NULL WHERE id=$1 AND locked_by=$2",
        [job.id, this.workerId],
      );
    } catch (error) {
      const finalAttempt = Number(job.attempt_count) >= 5;
      await this.pool.query(
        "UPDATE booking_otp_delivery_jobs SET status='FAILED',available_at=CASE WHEN $3 THEN available_at ELSE now()+make_interval(secs => least(300,30*attempt_count)) END,failed_at=CASE WHEN $3 THEN now() ELSE failed_at END,locked_at=NULL,locked_by=NULL,last_error=$4 WHERE id=$1 AND locked_by=$2",
        [
          job.id,
          this.workerId,
          finalAttempt,
          error instanceof Error
            ? error.message.slice(0, 500)
            : "OTP delivery failed",
        ],
      );
    }
  }

  private decryptOtp(value: string) {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue)
      throw new Error("OTP delivery payload is invalid");
    const key = createHash("sha256")
      .update(process.env.OTP_PEPPER ?? "development-otp-pepper")
      .digest();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
