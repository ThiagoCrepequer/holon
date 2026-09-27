import { expect, it } from "vitest";

import { createConfigurationSnapshotReader } from "../src/configuration-reader.js";
const base = "a".repeat(40),
  root = "b".repeat(40),
  blob = "c".repeat(40);
const transport = (mode = "100644", truncated = false, failure?: number) => ({
  request: async (route: string) => {
    if (failure !== undefined) throw { status: failure };
    return {
      data: route.includes("commits")
        ? { sha: base, tree: { sha: root } }
        : route.includes("trees")
          ? {
              sha: root,
              truncated,
              tree: [
                { path: ".holon.yml", sha: blob, mode, type: "blob", size: 2 },
              ],
            }
          : { sha: blob, encoding: "base64", content: "e30=", size: 2 },
    };
  },
});
it("reads proven regular blobs and proves absence from complete trees", async () => {
  const reader = createConfigurationSnapshotReader(transport(), "o", "r", base);
  expect(await reader.readFile(".holon.yml", 65536)).toEqual({
    kind: "found",
    bytes: new TextEncoder().encode("{}"),
  });
  expect(await reader.readFile("missing.yml", 65536)).toEqual({
    kind: "absent",
  });
});
it("does not treat a 404 or truncated tree as absence", async () => {
  expect(
    await createConfigurationSnapshotReader(
      transport("100644", false, 404),
      "o",
      "r",
      base,
    ).readFile("missing", 100),
  ).toEqual({ kind: "snapshot_unavailable" });
  expect(
    await createConfigurationSnapshotReader(
      transport("100644", true),
      "o",
      "r",
      base,
    ).readFile("missing", 100),
  ).not.toEqual({ kind: "absent" });
});
it.each(["120000", "160000", "040000"])(
  "rejects nonregular modes %s",
  async (mode) => {
    expect(
      await createConfigurationSnapshotReader(
        transport(mode),
        "o",
        "r",
        base,
      ).readFile(".holon.yml", 100),
    ).toEqual({ kind: "invalid_file" });
  },
);
it("enforces declared size and reference policy", async () => {
  const reader = createConfigurationSnapshotReader(transport(), "o", "r", base);
  expect(await reader.readFile(".holon.yml", 1)).toEqual({ kind: "too_large" });
  expect(reader.isReferenceAllowed(".env", [])).toBe(false);
  expect(reader.isReferenceAllowed("docs/private.md", ["docs/**"])).toBe(false);
});

it.each([
  [401, "access_denied"],
  [403, "access_denied"],
  [500, "transient_failure"],
] as const)("preserves transport failure %i as %s", async (status, kind) => {
  const reader = createConfigurationSnapshotReader(
    transport("100644", false, status),
    "o",
    "r",
    base,
  );
  expect(await reader.readFile(".holon.yml", 100)).toMatchObject({ kind });
  await expect(reader.directoryExists(".")).rejects.toMatchObject({
    code: kind,
  });
});

it("retains Retry-After across file and directory failures", async () => {
  const reader = createConfigurationSnapshotReader(
    {
      request: async () => {
        throw { status: 429, response: { headers: { "retry-after": "3" } } };
      },
    },
    "o",
    "r",
    base,
  );
  expect(await reader.readFile(".holon.yml", 100)).toEqual({
    kind: "transient_failure",
    retryAfterMs: 3000,
  });
  await expect(reader.directoryExists("docs")).rejects.toMatchObject({
    code: "transient_failure",
    retryAfterMs: 3000,
  });
});

it("walks exact-case directories, caches trees and refuses intermediate symlinks", async () => {
  const calls: string[] = [];
  const child = "d".repeat(40);
  const reader = createConfigurationSnapshotReader(
    {
      request: async (route, args) => {
        calls.push(route);
        return {
          data: route.includes("commits")
            ? { sha: base, tree: { sha: root } }
            : route.includes("trees")
              ? {
                  sha: args.tree_sha,
                  truncated: false,
                  tree:
                    args.tree_sha === root
                      ? [
                          {
                            path: "docs",
                            mode: "040000",
                            type: "tree",
                            sha: child,
                          },
                          {
                            path: "link",
                            mode: "120000",
                            type: "blob",
                            sha: blob,
                          },
                        ]
                      : [
                          {
                            path: "guide.md",
                            mode: "100755",
                            type: "blob",
                            sha: blob,
                          },
                        ],
                }
              : { sha: blob, encoding: "base64", content: "e30=", size: 2 },
        };
      },
    },
    "o",
    "r",
    base,
  );
  expect(await reader.directoryExists(".")).toBe(true);
  expect(await reader.directoryExists("docs")).toBe(true);
  expect(await reader.directoryExists("Docs")).toBe(false);
  expect(await reader.readFile("docs/guide.md", 100)).toMatchObject({
    kind: "found",
  });
  expect(await reader.readFile("Docs/guide.md", 100)).toEqual({
    kind: "absent",
  });
  expect(await reader.readFile("link/guide.md", 100)).toEqual({
    kind: "invalid_file",
  });
  await expect(reader.directoryExists("link")).rejects.toMatchObject({
    code: "invalid_file",
  });
  expect(calls.filter((route) => route.includes("commits"))).toHaveLength(1);
  expect(calls.filter((route) => route.includes("trees"))).toHaveLength(2);
});

it.each([
  { sha: blob, encoding: "utf8", content: "{}", size: 2 },
  { sha: root, encoding: "base64", content: "e30=", size: 2 },
  { sha: blob, encoding: "base64", content: "????", size: 2 },
  { sha: blob, encoding: "base64", content: "e30=", size: 1 },
  { sha: blob, encoding: "base64", content: "/w==", size: 1 },
  { sha: blob, encoding: "base64", content: "AA==", size: 1 },
  {
    sha: blob,
    encoding: "base64",
    content: btoa("version https://git-lfs.github.com/spec/v1"),
    size: 42,
  },
  null,
])("rejects malformed or forbidden blob %#", async (data) => {
  const normal = transport();
  const reader = createConfigurationSnapshotReader(
    {
      request: async (route) =>
        route.includes("blobs")
          ? { data }
          : route.includes("trees")
            ? {
                data: {
                  sha: root,
                  truncated: false,
                  tree: [
                    {
                      path: ".holon.yml",
                      sha: blob,
                      mode: "100644",
                      type: "blob",
                    },
                  ],
                },
              }
            : normal.request(route),
    },
    "o",
    "r",
    base,
  );
  expect(await reader.readFile(".holon.yml", 100)).toEqual({
    kind: "invalid_file",
  });
});

it.each([
  {
    sha: root,
    truncated: false,
    tree: [{ path: "bad/path", mode: "100644", type: "blob", sha: blob }],
  },
  { sha: root, truncated: false, tree: [1] },
  {
    sha: root,
    truncated: false,
    tree: Array.from({ length: 2 }, () => ({
      path: "duplicate",
      mode: "100644",
      type: "blob",
      sha: blob,
    })),
  },
])("rejects invalid tree entries %#", async (data) => {
  const normal = transport();
  const reader = createConfigurationSnapshotReader(
    {
      request: async (route) =>
        route.includes("trees") ? { data } : normal.request(route),
    },
    "o",
    "r",
    base,
  );
  expect(await reader.readFile("missing", 100)).toEqual({
    kind: "invalid_file",
  });
});

it("rejects wrong commit authority and enforces response and decode bounds", async () => {
  const mismatch = createConfigurationSnapshotReader(
    { request: async () => ({ data: { sha: root } }) },
    "o",
    "r",
    base,
  );
  expect(await mismatch.readFile(".holon.yml", 100)).toEqual({
    kind: "snapshot_unavailable",
  });
  for (const size of [0, -1, 65537, 1.5])
    expect(await mismatch.readFile(".holon.yml", size)).toEqual({
      kind: "too_large",
    });
  for (const data of [
    { sha: blob, encoding: "base64", content: "e30=", size: 101 },
    { sha: blob, encoding: "base64", content: "a".repeat(200), size: 2 },
    { sha: blob, encoding: "base64", content: btoa("a".repeat(101)), size: 2 },
  ]) {
    const normal = transport();
    const reader = createConfigurationSnapshotReader(
      {
        request: async (route) =>
          route.includes("blobs") ? { data } : normal.request(route),
      },
      "o",
      "r",
      base,
    );
    expect(await reader.readFile(".holon.yml", 100)).toEqual({
      kind: "too_large",
    });
  }
});
