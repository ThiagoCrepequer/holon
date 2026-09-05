import {
  adminReadRequestV1Schema,
  adminRunDetailV2Schema,
  type AdminRunDetailV2,
  adminRunDetailV1Schema,
  type AdminRunDetailV1,
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
    const detail = await this.env.REVIEW_LEDGERS.getByName(
      derivePrKeyFromRunId(runId),
    ).getSanitizedAdminRunDetailV1(runId);
    return detail === null
      ? null
      : adminRunDetailV2Schema.parse({
          ...detail,
          schemaVersion: 2,
          projectIdentification: detail.projectIdentification ?? null,
        });
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
    if (detail === null) return null;
    const { projectIdentification: _versions, ...legacy } = detail;
    return adminRunDetailV1Schema.parse(legacy);
  }
}
