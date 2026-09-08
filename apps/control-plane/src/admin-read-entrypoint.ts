import { adminReadRequestSchema, type AdminRunDetail } from "@holon/contracts";
import { derivePrKeyFromRunId } from "@holon/domain";
import { WorkerEntrypoint } from "cloudflare:workers";

export class AdminReadEntrypoint extends WorkerEntrypoint<Cloudflare.Env> {
  public async ping(): Promise<{ readonly ok: true }> {
    return { ok: true };
  }
  public async getRunDetail(request: unknown): Promise<AdminRunDetail | null> {
    const { runId } = adminReadRequestSchema.parse(request);
    // Project this capability: the full ledger RPC mapped type exceeds TS depth.
    const ledger = this.env.REVIEW_LEDGERS.getByName(
      derivePrKeyFromRunId(runId),
    ) as unknown as {
      getSanitizedAdminRunDetail(runId: string): Promise<AdminRunDetail | null>;
    };
    return ledger.getSanitizedAdminRunDetail(runId);
  }
}
