import { createHash } from "node:crypto";

import { expect, it, vi } from "vitest";

import { readLocalDiff, resolveMergeBase } from "../src/local-diff.js";
import type { SandboxCommandResult } from "../src/sandbox-port.js";
const request = {
  baseSha: "b".repeat(40),
  headSha: "a".repeat(40),
  pullRequestNumber: 7,
};
const result = (
  stdout = "",
  extra: Partial<SandboxCommandResult> = {},
): SandboxCommandResult => ({
  exitCode: 0,
  stdout,
  stderr: "",
  truncated: false,
  ...extra,
});
it("deepens exact fork PR refs until all history above the merge base is complete", async () => {
  let merges = 0,
    histories = 0;
  const run = vi.fn(async (args: readonly string[]) => {
    if (args.includes("merge-base"))
      return ++merges === 1
        ? result("", { exitCode: 1 })
        : result(request.baseSha);
    if (args[0] === "node")
      return result(++histories === 1 ? "incomplete" : "complete");
    return result();
  });
  expect(
    await resolveMergeBase(
      { run },
      request,
      "http://github.holon.internal/acme/repo.git",
      "/repo",
    ),
  ).toBe(request.baseSha);
  const fetches = run.mock.calls
    .filter(([args]) => args.includes("fetch"))
    .map(([args]) => args);
  expect(fetches).toHaveLength(3);
  expect(fetches.map((args) => args[3])).toEqual([
    "--depth=64",
    "--depth=256",
    "--depth=1024",
  ]);
  for (const args of fetches)
    expect(args).toEqual(
      expect.arrayContaining([
        request.baseSha,
        request.headSha,
        "+refs/pull/7/head:refs/holon/head",
      ]),
    );
});
it.each([
  ["fetch", result("", { exitCode: 1 }), "fetch:command-failed"],
  ["merge", result("", { exitCode: 128 }), "merge-base:command-failed"],
  [
    "merge",
    result(request.baseSha + "\n" + request.headSha),
    "merge-base:unavailable",
  ],
  [
    "merge",
    result(request.baseSha, { truncated: true }),
    "merge-base:unavailable",
  ],
  ["history", result("garbage"), "merge-base:unavailable"],
  ["history", result("", { exitCode: 1 }), "merge-base:unavailable"],
] as const)("fails closed for %s failure", async (phase, failure, message) => {
  const run = async (args: readonly string[]) =>
    args.includes("fetch")
      ? phase === "fetch"
        ? failure
        : result()
      : args.includes("merge-base")
        ? phase === "merge"
          ? failure
          : result(request.baseSha)
        : failure;
  await expect(
    resolveMergeBase({ run }, request, "url", "cwd"),
  ).rejects.toThrow(message);
});
it("bounds missing histories and respects the total deadline", async () => {
  const run = vi.fn(async (args: readonly string[]) =>
    result("", { exitCode: args.includes("merge-base") ? 1 : 0 }),
  );
  await expect(
    resolveMergeBase({ run }, request, "url", "cwd"),
  ).rejects.toThrow("history-incomplete");
  expect(
    run.mock.calls.filter(([args]) => args.includes("fetch")),
  ).toHaveLength(4);
  await expect(
    resolveMergeBase({ run }, request, "url", "cwd", 0),
  ).rejects.toThrow("timed-out");
});
function diffSource(
  content: string,
  mutate?: (r: SandboxCommandResult, index: number) => SandboxCommandResult,
) {
  const bytes = Buffer.from(content);
  let calls = 0;
  const run = vi.fn(async (args: readonly string[]) => {
    const value =
      args.length === 6
        ? JSON.stringify({
            bytes: bytes.length,
            digest: createHash("sha256").update(bytes).digest("hex"),
          })
        : bytes
            .subarray(Number(args[4]), Number(args[4]) + 48000)
            .toString("base64");
    const r = result(value);
    return mutate?.(r, calls++) ?? r;
  });
  return { run };
}
it("reassembles bounded binary pages including split UTF-8 and rejects corrupt pages", async () => {
  const text = "x".repeat(47999) + "😀" + "y".repeat(70000);
  const source = diffSource(text);
  expect(
    await readLocalDiff(source, request.baseSha, request.headSha, "cwd"),
  ).toBe(text);
  expect(source.run.mock.calls).toHaveLength(4);
  await expect(
    readLocalDiff(
      diffSource(text, (r, i) =>
        i === 1
          ? { ...r, stdout: Buffer.alloc(48000, 120).toString("base64") }
          : r,
      ),
      request.baseSha,
      request.headSha,
      "cwd",
    ),
  ).rejects.toThrow("integrity-failed");
  await expect(
    readLocalDiff(
      diffSource(text, (r, i) => (i === 1 ? { ...r, stdout: "" } : r)),
      request.baseSha,
      request.headSha,
      "cwd",
    ),
  ).rejects.toThrow();
  await expect(
    readLocalDiff(diffSource(text), request.baseSha, request.headSha, "cwd", 0),
  ).rejects.toThrow("timed-out");
});
it.each([
  result("", { exitCode: 3 }),
  result("", { timedOut: true }),
  result("", { exitCode: 1 }),
  result(JSON.stringify({ bytes: 16000001, digest: "a".repeat(64) })),
])("rejects generation failure or oversized manifests", async (r) => {
  await expect(
    readLocalDiff(
      { run: async () => r },
      request.baseSha,
      request.headSha,
      "cwd",
    ),
  ).rejects.toThrow();
});
it("does not consume truncated pages", async () => {
  await expect(
    readLocalDiff(
      diffSource("data", (r, i) => (i === 1 ? { ...r, truncated: true } : r)),
      request.baseSha,
      request.headSha,
      "cwd",
    ),
  ).rejects.toThrow();
});
