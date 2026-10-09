import {
  compileRepositoryConfiguration,
  configurationDigest,
  projectConfigurationGuidance,
} from "@holon/application";
import { parseRepositoryConfigurationYaml } from "@holon/repository-config";
import { describe, expect, it, vi } from "vitest";

import {
  createReviewGuidanceResolver,
  resolveReviewGuidance,
} from "../src/review/review-guidance.js";
import { configurationReader } from "./configuration-fixtures.js";
const base = "b".repeat(40);
it("shares pinned documentation across concurrent shards only within one invocation", async () => {
  const content = "Node API";
  const reference = {
    root: ".",
    technology: "node",
    version: "24.0.0",
    url: "https://nodejs.org/api/",
    sha256: await configurationDigest(content),
  };
  const identification = {
    projects: [
      {
        root: ".",
        technologies: [
          { name: "node", declarations: [{ kind: "locked", value: "24.0.0" }] },
        ],
      },
    ],
  } as never;
  const fetcher = vi.fn(async () => new Response(content));
  const resolve = createReviewGuidanceResolver(fetcher);
  const [first, second] = await Promise.all([
    resolve([reference], ["a.ts"], identification),
    resolve([reference], ["b.ts"], identification),
  ]);
  expect(first.documentation).toEqual(second.documentation);
  expect(fetcher).toHaveBeenCalledOnce();
  await createReviewGuidanceResolver(fetcher)(
    [reference],
    ["a.ts"],
    identification,
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
async function compile(yaml: string) {
  return compileRepositoryConfiguration(
    {
      runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${base}`,
      installationId: 99,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: "a".repeat(40),
      baseSha: base,
    },
    configurationReader({ ".holon.yml": yaml }),
    parseRepositoryConfigurationYaml,
  );
}
describe("project guidance", () => {
  it("accepts bounded directions and compatibility by project without changing observed versions", async () => {
    const yaml =
      'instructions: ["Check tenant boundaries"]\nprojects:\n  - name: api\n    root: apps/api\n    instructions: ["Keep writes transactional"]\n    compatibility:\n      runtimes:\n        node: "22"\n';
    const snapshot = await compile(yaml);
    const context = projectConfigurationGuidance(snapshot, [
      "apps/api/src/a.ts",
    ]);
    expect(JSON.stringify(context)).toContain("Check tenant boundaries");
    expect(snapshot.config.projects[0]?.compatibility).toEqual({
      runtimes: { node: "22" },
    });
    expect(JSON.stringify(context)).toContain("Keep writes transactional");
    expect(
      JSON.stringify(projectConfigurationGuidance(snapshot, ["apps/web/a.ts"])),
    ).not.toContain("Keep writes transactional");
  });
  it("rejects unsupported documentation hosts at the configuration boundary", async () => {
    const yaml =
      'review:\n  documentation:\n    - root: .\n      technology: node\n      version: "22.0.0"\n      url: https://127.0.0.1/private\n      sha256: ' +
      "a".repeat(64);
    await expect(compile(yaml)).rejects.toThrow();
  });
});

it("verifies the content digest and observed exact version before supplying external docs", async () => {
  const content = "Node 22 API reference";
  const digest = await configurationDigest(content);
  const yaml = `review:\n  documentation:\n    - root: .\n      technology: node\n      version: "22.0.0"\n      url: https://nodejs.org/docs/v22.0.0/api/\n      sha256: ${digest}\n`;
  const policy = (await compile(yaml)).config.documentation;
  const identification = {
    projects: [
      {
        root: ".",
        technologies: [
          { name: "node", declarations: [{ kind: "locked", value: "22.0.0" }] },
        ],
      },
    ],
  } as never;
  const fetcher = vi.fn().mockResolvedValue(new Response(content));
  const result = await resolveReviewGuidance(
    policy,
    ["a.ts"],
    identification,
    fetcher,
  );
  expect(result.documentation[0]).toMatchObject({
    version: "22.0.0",
    content,
    sha256: digest,
  });
  expect(fetcher).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ redirect: "error" }),
  );
  fetcher.mockResolvedValue(new Response("changed upstream documentation"));
  const changed = await resolveReviewGuidance(
    policy,
    ["a.ts"],
    identification,
    fetcher,
  );
  expect(changed.documentation).toEqual([]);
  expect(changed.limitations).toContain(
    "Pinned documentation unavailable for node 22.0.0.",
  );
  fetcher.mockClear();
  const unmatched = await resolveReviewGuidance(
    policy,
    ["a.ts"],
    undefined,
    fetcher,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(unmatched.limitations[0]).toContain("no exact observed version");
});
it("bounds external document bodies while streaming and records unavailable sources", async () => {
  const yaml = `review:\n  documentation:\n    - root: .\n      technology: node\n      version: "22.0.0"\n      url: https://nodejs.org/docs/v22.0.0/api/\n      sha256: ${"a".repeat(64)}\n`;
  const policy = (await compile(yaml)).config.documentation;
  const identification = {
    projects: [
      {
        root: ".",
        technologies: [
          {
            name: "node",
            declarations: [{ kind: "declared-exact", value: "22.0.0" }],
          },
        ],
      },
    ],
  } as never;
  const cancel = vi.fn();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(64001));
    },
    cancel,
  });
  const result = await resolveReviewGuidance(
    policy,
    ["a.ts"],
    identification,
    vi.fn().mockResolvedValue(new Response(stream)),
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(result.documentation).toEqual([]);
});

it("omits complete guidance entries under the shared byte budget", async () => {
  const content = "reference ".repeat(1000);
  const sha256 = await configurationDigest(content);
  const policy = Array.from({ length: 4 }, () => ({
    root: ".",
    technology: "node",
    version: "22.0.0",
    url: "https://nodejs.org/api/",
    sha256,
  }));
  const identification = {
    projects: [
      {
        root: ".",
        technologies: [
          {
            name: "node",
            declarations: [{ kind: "declared-exact", value: "22.0.0" }],
          },
        ],
      },
    ],
  } as never;
  const result = await resolveReviewGuidance(
    policy,
    ["apps/api/a.ts"],
    identification,
    vi.fn(async () => new Response(content)),
  );
  expect(
    new TextEncoder().encode(JSON.stringify(result)).length,
  ).toBeLessThanOrEqual(24000);
  expect(result.limitations).toContain(
    "Supplementary project guidance exceeds the context budget; complete entries were omitted.",
  );
  expect(result.documentation.length).toBeLessThan(4);
  expect(result.documentation.length).toBeGreaterThan(0);
});
it("does not fetch docs outside a shard and treats an unavailable source as a limitation", async () => {
  const config = {
    root: "apps/api",
    technology: "node",
    version: "22",
    url: "https://nodejs.org/api/",
    sha256: "a".repeat(64),
  };
  const policy = [config];
  const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
  await resolveReviewGuidance(policy, ["apps/web/a.ts"], undefined, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  const identification = {
    projects: [
      {
        root: "apps/api",
        technologies: [
          { name: "node", declarations: [{ kind: "locked", value: "22" }] },
        ],
      },
    ],
  } as never;
  expect(
    (
      await resolveReviewGuidance(
        policy,
        ["apps/api/a.ts"],
        identification,
        fetcher,
      )
    ).limitations,
  ).toHaveLength(1);
});
