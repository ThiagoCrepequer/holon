import type { ProjectIdentificationModel } from "@holon/application";
import {
  projectIdentificationResultSchema,
  type PreparedRepository,
  type ProjectIdentificationResult,
  type ProjectMetadataRequest,
  type RepositoryPolicy,
  type ReviewJob,
} from "@holon/contracts";
import { GatewayProjectIdentificationModel } from "@holon/model";
import {
  detectorRevision,
  interpretProjects,
} from "@holon/project-identification";

export interface ProjectMetadataExecutor {
  discoverProjectMetadata(
    request: ProjectMetadataRequest,
  ): Promise<ProjectIdentificationResult>;
  hasContext(runId: string): Promise<boolean>;
}

export type ProjectIdentifier = (
  policy: RepositoryPolicy,
  input?: ProjectIdentificationResult,
  discoveryOnly?: boolean,
  deadlineAt?: number,
) => Promise<ProjectIdentificationResult>;

export function createProjectIdentifier(
  env: Cloudflare.Env,
  job: ReviewJob,
  executor: ProjectMetadataExecutor,
  prepareRepository: (
    maximumAttempts: number,
    policy: RepositoryPolicy,
  ) => Promise<PreparedRepository>,
  identificationModel?: ProjectIdentificationModel,
): ProjectIdentifier {
  const unavailable = (reason: string): ProjectIdentificationResult => ({
    snapshotSha: job.envelope.pullRequest.headSha,
    inventoryDigest: "0".repeat(64),
    detectorRevision,
    projects: [],
    status: "unavailable",
    limitations: [reason],
  });

  return async (
    policy,
    input,
    discoveryOnly = false,
    deadlineAt = Date.now() + 120000,
  ) => {
    const cacheName = await env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
      String(job.envelope.installationId),
    ).register(job.envelope.installationId, job.envelope.repository.id);
    if (!cacheName) return unavailable("access-revoked");
    if (!input && !(await executor.hasContext(job.runId)))
      await prepareRepository(1, policy);
    const request: ProjectMetadataRequest = {
      runId: job.runId,
      installationId: job.envelope.installationId,
      repositoryId: job.envelope.repository.id,
      snapshotSha: job.envelope.pullRequest.headSha,
      policyDigest: policy.effectivePolicyDigest,
      modelRevision:
        env.AI_MODEL_ID +
        ":" +
        detectorRevision +
        ":" +
        env.PROJECT_IDENTIFICATION_PROFILE,
      mode: "affected",
      deadlineAt,
    };
    let result: ProjectIdentificationResult;
    try {
      result =
        input ??
        projectIdentificationResultSchema.parse(
          await executor.discoverProjectMetadata(request),
        );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("PROJECT_METADATA_AUTHORITY")
      )
        throw error;
      return unavailable("metadata-unavailable");
    }
    if (!input && result.metadataChanged) {
      try {
        const base = projectIdentificationResultSchema.parse(
          await executor.discoverProjectMetadata({
            ...request,
            snapshotSha: job.envelope.pullRequest.baseSha,
          }),
        );
        result = {
          ...result,
          baseline: {
            snapshotSha: base.snapshotSha,
            projects: base.projects,
            status: base.status === "complete" ? "complete" : "partial",
            limitations: base.limitations,
          },
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("PROJECT_METADATA_AUTHORITY")
        )
          throw error;
        result = {
          ...result,
          baseline: {
            snapshotSha: job.envelope.pullRequest.baseSha,
            projects: [],
            status: "unavailable",
            limitations: ["base-metadata-unavailable"],
          },
        };
      }
    }
    if (discoveryOnly) return result;
    const usage = { inputTokens: 0, outputTokens: 0, modelCalls: 0 };
    const cache = env.PROJECT_IDENTIFICATION_CACHE.getByName(cacheName);
    const model =
      identificationModel ??
      new GatewayProjectIdentificationModel(
        {
          accountId: env.AI_GATEWAY_ACCOUNT_ID,
          apiToken: env.AI_GATEWAY_API_TOKEN,
          gatewayId: env.AI_GATEWAY_ID,
          model: env.AI_MODEL_ID,
        },
        (consumedInput, output) => {
          usage.inputTokens += consumedInput;
          usage.outputTokens += output;
        },
      );
    let interpreted: ProjectIdentificationResult;
    try {
      interpreted = await interpretProjects(result, {
        cache,
        owner: job.runId,
        model,
        deadlineAt,
        onAttempt: () => {
          usage.modelCalls++;
        },
      });
    } catch {
      interpreted = {
        ...result,
        status: "partial",
        limitations: [
          ...result.limitations,
          "identification-cache-unavailable",
        ],
      };
    }
    return { ...interpreted, usage };
  };
}
