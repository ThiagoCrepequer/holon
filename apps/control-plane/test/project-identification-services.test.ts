import { reviewJobSchema } from "@holon/contracts";
import { identifySnapshot } from "@holon/project-identification";
import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, it, expect, vi } from "vitest";

import {
  createReviewServices,
  type RepositoryExecutorBinding,
} from "../src/review-services.js";
import { defaultScopePolicy } from "./configuration-fixtures.js";
import { unconfiguredExecutor } from "./executor-fixture.js";
afterEach(() => reset());
const sha = "a".repeat(40),
  base = "b".repeat(40);
const job = reviewJobSchema.parse({
  runId: `github:42:pr:7:head:${sha}:base:${"b".repeat(40)}`,
  envelope: {
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
  discover: RepositoryExecutorBinding["discoverProjectMetadata"],
  mode = "enrich",
) {
  const identify = vi.fn(async () => ({ selectedFactIds: ["fact-0"] }));
  const service = createReviewServices(
    {
      ...env,
      PROJECT_IDENTIFICATION_MODE: mode,
    } as Cloudflare.Env,
    job,
    {
      identificationModel: { identify },
      executor: {
        ...unconfiguredExecutor,
        hasContext: async () => true,
        cleanup: async () => {},
        runTool: async () => ({ content: "", truncated: false }),
        discoverProjectMetadata: discover,
      },
    },
    { emit: () => {} },
    {},
  );
  return { service, identify };
}
it("discovers both immutable snapshots then reuses a verified cache entry", async () => {
  const result = { ...(await snapshot()), metadataChanged: true };
  const discover = vi.fn(async (request) => ({
    ...result,
    snapshotSha: request.snapshotSha,
  }));
  const { service, identify } = setup(discover);
  const policy = await defaultScopePolicy(base);
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
  expect(service.getProjectIdentification!()?.usage).toMatchObject({
    inputTokens: 100,
    outputTokens: 20,
  });
});
it("observe persists a result without enriching review context", async () => {
  const { service } = setup(async () => await snapshot(), "observe");
  const r = await service.identifyProjects!(await defaultScopePolicy(base));
  service.useProjectIdentification!(r!);
  expect(service.getProjectIdentification!()).toBeUndefined();
});
it("reports optional failures but propagates authority rejection", async () => {
  const policy = await defaultScopePolicy(base);
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
      await defaultScopePolicy(base),
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
    await service.identifyProjects!(await defaultScopePolicy(base)),
  ).toMatchObject({ limitations: ["access-revoked"] });
  expect(discover).not.toHaveBeenCalled();
  expect(identify).not.toHaveBeenCalled();
});

it("propagates revoked authority during baseline discovery without model inference", async () => {
  const head = { ...(await snapshot()), metadataChanged: true };
  const discover = vi.fn(async (request) => {
    if (request.snapshotSha === base)
      throw new Error("PROJECT_METADATA_AUTHORITY");
    return head;
  });
  const { service, identify } = setup(discover);
  await expect(
    service.identifyProjects!(await defaultScopePolicy(base)),
  ).rejects.toThrow("PROJECT_METADATA_AUTHORITY");
  expect(discover).toHaveBeenCalledTimes(2);
  expect(identify).not.toHaveBeenCalled();
});

it("preserves partial baseline status and limitations alongside complete head metadata", async () => {
  const head = { ...(await snapshot()), metadataChanged: true };
  const { service, identify } = setup(async (request) =>
    request.snapshotSha === base
      ? {
          ...head,
          snapshotSha: base,
          status: "partial",
          limitations: ["metadata-file-budget"],
        }
      : head,
  );
  const result = await service.identifyProjects!(
    await defaultScopePolicy(base),
    undefined,
    true,
  );
  expect(result).toMatchObject({
    status: "complete",
    baseline: {
      snapshotSha: base,
      status: "partial",
      limitations: ["metadata-file-budget"],
    },
  });
  expect(identify).not.toHaveBeenCalled();
});
