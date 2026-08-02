import { Injectable } from "@nestjs/common";

export const ASSET_WORKER_JOBS = [
  "asset.depreciation.calculate",
  "asset.depreciation.post",
  "asset.maintenance.due",
  "asset.warranty.expiry",
  "asset.reconciliation.snapshot",
] as const;

@Injectable()
export class AssetProcessor {
  /**
   * Asset jobs are intentionally claimed by the durable outbox/worker boundary.
   * Domain commands remain the only place allowed to mutate posted economics.
   */
  async handle(job: (typeof ASSET_WORKER_JOBS)[number]) {
    if (!ASSET_WORKER_JOBS.includes(job)) throw new Error("ASSET_JOB_UNSUPPORTED");
    return { job, accepted: true, refetchRequired: true };
  }
}
