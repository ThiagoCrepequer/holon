import type {
  ProjectIdentificationCache,
  ProjectIdentificationModel,
} from "@holon/application";
import { it, expect, vi } from "vitest";

import {
  identifySnapshot,
  interpretProjects,
  verifyInterpretation,
} from "../src/index.js";
async function fixture() {
  return identifySnapshot({
    snapshotSha: "a".repeat(40),
    policyDigest: "p",
    modelRevision: "m",
    files: [
      { path: "package.json", content: '{"dependencies":{"react":"19.0.0"}}' },
    ],
  });
}
function cache() {
  return {
    claim: vi
      .fn<ProjectIdentificationCache["claim"]>()
      .mockResolvedValue({ status: "claimed", token: 1 }),
    attempt: vi
      .fn<ProjectIdentificationCache["attempt"]>()
      .mockResolvedValue(true),
    complete: vi
      .fn<ProjectIdentificationCache["complete"]>()
      .mockResolvedValue(true),
    fail: vi
      .fn<ProjectIdentificationCache["fail"]>()
      .mockResolvedValue(undefined),
  };
}
it("a cache hit never calls the model", async () => {
  const input = await fixture(),
    c = cache(),
    model = { identify: vi.fn() };
  vi.mocked(c.claim).mockResolvedValue({
    status: "hit",
    project: input.projects[0]!,
  });
  expect(
    await interpretProjects(input, { cache: c, model, owner: "run" }),
  ).toEqual(input);
  expect(model.identify).not.toHaveBeenCalled();
});
it("rejects invented and duplicated evidence", async () => {
  const p = (await fixture()).projects[0]!;
  expect(() =>
    verifyInterpretation(p, { selectedFactIds: ["missing"] }),
  ).toThrow();
  expect(() =>
    verifyInterpretation(p, { selectedFactIds: ["fact-0", "fact-0"] }),
  ).toThrow();
  expect(
    verifyInterpretation(p, { selectedFactIds: ["fact-0"] }).interpretation,
  ).toBe("model-verified");
});
it("persists verified output and preserves declarations", async () => {
  const input = await fixture(),
    c = cache();
  const model = {
    identify: vi.fn().mockResolvedValue({ selectedFactIds: [] }),
  };
  const r = await interpretProjects(input, { cache: c, model, owner: "run" });
  expect(r.projects[0]?.technologies).toEqual(input.projects[0]?.technologies);
  expect(c.complete).toHaveBeenCalledTimes(1);
});
it.each(["pending", "unavailable"] as const)(
  "reports %s without calling model",
  async (status) => {
    const input = await fixture(),
      c = cache(),
      model = { identify: vi.fn() };
    vi.mocked(c.claim).mockResolvedValue(
      status === "pending" ? { status, retryAt: 10 } : { status },
    );
    expect(
      (await interpretProjects(input, { cache: c, model, owner: "run" }))
        .status,
    ).toBe("partial");
    expect(model.identify).not.toHaveBeenCalled();
  },
);
it("limits failures to two attempts", async () => {
  const c = cache();
  const model = {
    identify: vi
      .fn<ProjectIdentificationModel["identify"]>()
      .mockRejectedValue(new Error("secret")),
  };
  const result = await interpretProjects(await fixture(), {
    cache: c,
    model,
    owner: "run",
  });
  expect(model.identify).toHaveBeenCalledTimes(2);
  expect(c.fail).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("honors durable attempt rejection", async () => {
  const c = cache();
  vi.mocked(c.attempt).mockResolvedValue(false);
  const model = { identify: vi.fn() };
  await interpretProjects(await fixture(), { cache: c, model, owner: "run" });
  expect(model.identify).not.toHaveBeenCalled();
});
it("discards output from a lost lease", async () => {
  const c = cache();
  vi.mocked(c.complete).mockResolvedValue(false);
  expect(
    (
      await interpretProjects(await fixture(), {
        cache: c,
        model: { identify: vi.fn().mockResolvedValue({ selectedFactIds: [] }) },
        owner: "run",
      })
    ).status,
  ).toBe("partial");
});
it("honors the stage deadline", async () => {
  let n = 0;
  const c = cache();
  const result = await interpretProjects(await fixture(), {
    cache: c,
    model: { identify: vi.fn() },
    owner: "run",
    now: () => (n++ === 0 ? 0 : 120001),
  });
  expect(result.projects[0]?.limitations).toContain("identification-deadline");
  expect(c.claim).not.toHaveBeenCalled();
});
it("classifies existing libraries without new version assertions", async () => {
  const p = (await fixture()).projects[0]!;
  expect(() =>
    verifyInterpretation(p, {
      selectedFactIds: [],
      classifications: [
        { name: "invented", category: "framework", evidenceIds: ["fact-0"] },
      ],
    }),
  ).toThrow();
  const custom = await identifySnapshot({
    snapshotSha: "a".repeat(40),
    policyDigest: "p",
    modelRevision: "m",
    files: [
      { path: "package.json", content: '{"dependencies":{"hono":"4.0.0"}}' },
    ],
  });
  const v = verifyInterpretation(custom.projects[0]!, {
    selectedFactIds: ["fact-0"],
    classifications: [
      { name: "hono", category: "framework", evidenceIds: ["fact-0"] },
    ],
  });
  expect(v.technologies[0]?.category).toBe("framework");
  expect(v.technologies[0]?.declarations).toEqual(
    custom.projects[0]?.technologies[0]?.declarations,
  );
});
it("honors a shared stage deadline without taking another lease", async () => {
  const c = cache();
  const result = await interpretProjects(await fixture(), {
    cache: c,
    model: { identify: vi.fn() },
    owner: "run",
    deadlineAt: 1,
  });
  expect(result.projects[0]?.limitations).toContain("identification-deadline");
  expect(c.claim).not.toHaveBeenCalled();
});
it("counts provider attempts even when the provider fails", async () => {
  const onAttempt = vi.fn();
  await interpretProjects(await fixture(), {
    cache: cache(),
    model: {
      identify: async () => {
        throw new Error("offline");
      },
    },
    owner: "run",
    onAttempt,
  });
  expect(onAttempt).toHaveBeenCalledTimes(2);
});
