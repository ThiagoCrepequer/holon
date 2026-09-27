import { adminReadRequestSchema, type AdminRunDetail } from "@holon/contracts";
import { derivePrKeyFromRunId } from "@holon/domain";
import { consoleErrorReporter, withErrorReporting } from "@holon/observability";
import { WorkerEntrypoint } from "cloudflare:workers";

export class AdminReadEntrypoint extends WorkerEntrypoint<Cloudflare.Env> {
  public async ping(): Promise<{ readonly ok: true }> {
    return { ok: true };
  }
  public async getRunDetail(request: unknown): Promise<AdminRunDetail | null> {
    return await withErrorReporting(
      "admin_read.rpc_failed",
      consoleErrorReporter,
      { component: "control-plane", operation: "admin.get_run_detail" },
      async () => {
        const { runId } = adminReadRequestSchema.parse(request);
        // Project this capability: the full ledger RPC mapped type exceeds TS depth.
        const ledger = this.env.REVIEW_LEDGERS.getByName(
          derivePrKeyFromRunId(runId),
        ) as unknown as {
          getSanitizedAdminRunDetail(
            runId: string,
          ): Promise<AdminRunDetail | null>;
        };
        return await ledger.getSanitizedAdminRunDetail(runId);
      },
    );
  }
}
