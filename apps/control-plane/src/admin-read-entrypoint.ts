import {
  adminReadRequestV1Schema,
  type AdminRunDetailV2,
} from "@holon/contracts";
import { derivePrKeyFromRunId } from "@holon/domain";
import { WorkerEntrypoint } from "cloudflare:workers";

export class AdminReadEntrypoint extends WorkerEntrypoint<Cloudflare.Env> {
  public async pingV1(): Promise<{ readonly schemaVersion: 1 }> {
    return { schemaVersion: 1 };
  }
  public async getRunDetailV2(
    request: unknown,
  ): Promise<AdminRunDetailV2 | null> {
    const { runId } = adminReadRequestV1Schema.parse(request);
    return this.env.REVIEW_LEDGERS.getByName(
      derivePrKeyFromRunId(runId),
    ).getSanitizedAdminRunDetailV2(runId);
  }
}
