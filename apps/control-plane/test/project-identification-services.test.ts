import { reviewJobV2Schema } from "@holon/contracts";
import { identifySnapshot } from "@holon/project-identification";
import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, it, expect, vi } from "vitest";

import { createDefaultRepositoryPolicy } from "../src/repository-policy-resolver.js";
import {
  createReviewServices,
  type RepositoryExecutorBinding,
} from "../src/review-services.js";
afterEach(() => reset());
const sha = "a".repeat(40),
  base = "b".repeat(40);
const job = reviewJobV2Schema.parse({
  schemaVersion: 2,
  runId: `github:42:pr:7:head:${sha}`,
  envelope: {
    schemaVersion: 2,
    event: "pull_request",
    action: "opened",
    deliveryId: "github:identification",
    installationId: 99,
    pullRequest: {
      baseSha: base,
      headSha: sha,
      number: 7,
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
    receivedAt: "2026-09-05T00:00:01.000Z",
    repository: { id: 42, name: "api", owner: "acme", fullName: "acme/api" },
  },
});
const snapshot = () =>
  identifySnapshot({
    snapshotSha: sha,
    policyDigest: "p",
    modelRevision: "m",
    files: [
      { path: "package.json", content: '{"dependencies":{"react":"19.0.0"}}' },
    ],
  });
function setup(
  discover?: RepositoryExecutorBinding["discoverProjectMetadataV1"],
  enabled = true,
  mode = "enrich",
) {
  const identify = vi.fn(async () => ({ selectedFactIds: ["fact-0"] }));
  const service = createReviewServices(
    {
      ...env,
      PROJECT_IDENTIFICATION_ENABLED: String(enabled),
      PROJECT_IDENTIFICATION_MODE: mode,
    } as Cloudflare.Env,
    job,
    {
      identificationModel: { identify },
      executor: {
        hasContext: async () => true,
        cleanup: async () => {},
        runTool: async () => ({ content: "", truncated: false }),
        ...(discover ? { discoverProjectMetadataV1: discover } : {}),
      },
    },
    { emit: () => {} },
    {},
  );
  return { service, identify };
}
it("skips disabled configuration and absent capability", async () => {
  const policy = await createDefaultRepositoryPolicy(base);
  expect(
    await setup(undefined, false).service.identifyProjects!(policy),
  ).toBeNull();
  expect(await setup().service.identifyProjects!(policy)).toMatchObject({
    status: "unavailable",
    limitations: ["executor-capability-unavailable"],
  });
});
it("discovers both immutable snapshots then reuses a verified cache entry", async () => {
  const result = { ...(await snapshot()), metadataChanged: true };
  const discover = vi.fn(async (request) => ({
    ...result,
    snapshotSha: request.snapshotSha,
  }));
  const { service, identify } = setup(discover);
  const policy = await createDefaultRepositoryPolicy(base);
  const discovery = await service.identifyProjects!(policy, undefined, true);
  expect(discovery?.baseline?.snapshotSha).toBe(base);
  expect(identify).not.toHaveBeenCalled();
  const first = await service.identifyProjects!(policy, discovery!);
  expect(first?.projects[0]?.interpretation).toBe("model-verified");
  const warm = await service.identifyProjects!(policy, discovery!);
  expect(warm?.projects).toEqual(first?.projects);
  expect(identify).toHaveBeenCalledTimes(1);
  service.useProjectIdentification!({
    ...first!,
    usage: { inputTokens: 100, outputTokens: 20, modelCalls: 1 },
  });
  expect(service.getProjectIdentification!()?.snapshotSha).toBe(sha);
  expect(service.getAccumulatedUsage()).toMatchObject({
    inputTokens: 100,
    outputTokens: 20,
  });
});
it("observe persists a result without enriching review context", async () => {
  const { service } = setup(async () => await snapshot(), true, "observe");
  const r = await service.identifyProjects!(
    await createDefaultRepositoryPolicy(base),
  );
  service.useProjectIdentification!(r!);
  expect(service.getProjectIdentification!()).toBeUndefined();
});
it("reports optional failures but propagates authority rejection", async () => {
  const policy = await createDefaultRepositoryPolicy(base);
  expect(
    await setup(async () => {
      throw new Error("offline");
    }).service.identifyProjects!(policy),
  ).toMatchObject({ status: "unavailable" });
  await expect(
    setup(async () => {
      throw new Error("PROJECT_METADATA_AUTHORITY");
    }).service.identifyProjects!(policy),
  ).rejects.toThrow("PROJECT_METADATA_AUTHORITY");
});
it("retains head evidence when base collection is unavailable", async () => {
  const r = { ...(await snapshot()), metadataChanged: true };
  const { service } = setup(async (request) => {
    if (request.snapshotSha === base) throw new Error("offline");
    return r;
  });
  expect(
    await service.identifyProjects!(
      await createDefaultRepositoryPolicy(base),
      undefined,
      true,
    ),
  ).toMatchObject({
    projects: r.projects,
    baseline: { status: "unavailable" },
  });
});
it("prevents discovery and inference after repository access removal", async () => {
  await env.PROJECT_IDENTIFICATION_REGISTRY.getByName("99").revoke(99, [42]);
  const discover = vi.fn(async () => await snapshot());
  const { service, identify } = setup(discover);
  expect(
    await service.identifyProjects!(await createDefaultRepositoryPolicy(base)),
  ).toMatchObject({ limitations: ["access-revoked"] });
  expect(discover).not.toHaveBeenCalled();
  expect(identify).not.toHaveBeenCalled();
});
