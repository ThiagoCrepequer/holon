import {
  adminReadRequestV1Schema,
  type AdminRunDetailV2,
  type AdminRunDetailV3,
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
  public async getRunDetailV3(
    request: unknown,
  ): Promise<AdminRunDetailV3 | null> {
    const { runId } = adminReadRequestV1Schema.parse(request);
    const ledgerStub = this.env.REVIEW_LEDGERS.getByName(
      derivePrKeyFromRunId(runId),
    ) as unknown as {
      getSanitizedAdminRunDetailV3(
        runId: string,
      ): Promise<AdminRunDetailV3 | null>;
    };
    return ledgerStub.getSanitizedAdminRunDetailV3(runId);
  }
}
