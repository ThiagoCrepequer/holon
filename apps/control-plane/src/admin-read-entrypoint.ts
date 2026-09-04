import {
  adminReadRequestV1Schema,
  adminRunDetailV1Schema,
  type AdminRunDetailV1,
} from "@holon/contracts";
import { derivePrKeyFromRunId } from "@holon/domain";
import { WorkerEntrypoint } from "cloudflare:workers";

export class AdminReadEntrypoint extends WorkerEntrypoint<Cloudflare.Env> {
  public async pingV1(): Promise<{ readonly schemaVersion: 1 }> {
    return { schemaVersion: 1 };
  }

  public async getRunDetailV1(
    request: unknown,
  ): Promise<AdminRunDetailV1 | null> {
    const { runId } = adminReadRequestV1Schema.parse(request);
    const prKey = derivePrKeyFromRunId(runId);
    const stub = this.env.REVIEW_LEDGERS.getByName(prKey) as {
      getSanitizedAdminRunDetailV1(
        runId: string,
      ): Promise<AdminRunDetailV1 | null>;
    };
    const detail = await stub.getSanitizedAdminRunDetailV1(runId);
    return detail === null ? null : adminRunDetailV1Schema.parse(detail);
  }
}
