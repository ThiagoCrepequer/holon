import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import { packEvidence, unpackEvidence } from "./archive.mjs";

await test("preserves original bytes and logical paths while storing identical evidence once", () => {
  const entries = new Map([
    ["first/source.ts.source", Buffer.from("abc")],
    ["repeat/source.ts.source", Buffer.from("abc")],
    ["results.json", Buffer.from('{"failed":true}\n')],
  ]);
  const packed = packEvidence(entries);
  const restored = unpackEvidence(packed.manifest, packed.archive);
  assert.equal(restored.get("results.json").toString(), '{"failed":true}\n');
  assert.equal(restored.get("first/source.ts.source").toString(), "abc");
  assert.equal(restored.get("repeat/source.ts.source").toString(), "abc");
  assert.equal(
    packed.manifest.entries["first/source.ts.source"].sha256,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(packed.manifest.blobCount, 2);
  assert.deepEqual(packEvidence(new Map([...entries].toReversed())), packed);
});

await test("rejects corruption, substituted content and inconsistent manifest entries", () => {
  const packed = packEvidence(new Map([["source", Buffer.from("abc")]]));
  const changedBytes = Buffer.from(packed.archive);
  changedBytes[0] ^= 1;
  assert.throws(() => unpackEvidence(packed.manifest, changedBytes));
  for (const change of [
    (m) => m.archive.bytes++,
    (m) => m.archive.expandedBytes++,
    (m) => m.blobCount++,
    (m) => m.entries.source.bytes++,
    (m) => (m.entries.source.sha256 = "0".repeat(64)),
    (m) => delete m.entries.source,
    (m) => (m.entries["../escape"] = m.entries.source),
  ]) {
    const manifest = structuredClone(packed.manifest);
    change(manifest);
    assert.throws(() => unpackEvidence(manifest, packed.archive));
  }
  for (const blobs of [
    { invalid: "YWJj" },
    { [packed.manifest.entries.source.sha256]: 123 },
    { [packed.manifest.entries.source.sha256]: "YWJj!" },
    { [packed.manifest.entries.source.sha256]: "ZGVm" },
    {
      ...JSON.parse(
        '{"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad":"YWJj"}',
      ),
      e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855: "",
    },
  ]) {
    const expanded = Buffer.from(JSON.stringify(blobs));
    const archive = gzipSync(expanded);
    const manifest = structuredClone(packed.manifest);
    manifest.archive = {
      sha256: createHash("sha256").update(archive).digest("hex"),
      bytes: archive.length,
      expandedBytes: expanded.length,
    };
    manifest.blobCount = Object.keys(blobs).length;
    assert.throws(() => unpackEvidence(manifest, archive));
  }
});

await test("bounds expansion and rejects unsafe paths and invalid input", () => {
  for (const path of [
    "",
    ".",
    "../x",
    "a/../x",
    "/x",
    "a\\x",
    "a\0x",
    "x".repeat(1025),
  ])
    assert.throws(() => packEvidence(new Map([[path, Buffer.from("abc")]])));
  assert.throws(() => packEvidence(new Map()));
  assert.throws(() => packEvidence(new Map([["source", "abc"]])));
  assert.throws(() =>
    packEvidence(new Map([["source", Buffer.alloc(16_000_000)]])),
  );
  const expanded = Buffer.alloc(16_000_001);
  const archive = gzipSync(expanded);
  const manifest = {
    archive: {
      sha256: createHash("sha256").update(archive).digest("hex"),
      bytes: archive.length,
      expandedBytes: expanded.length,
    },
  };
  assert.throws(() => unpackEvidence(manifest, archive), {
    code: "ERR_BUFFER_TOO_LARGE",
  });
  assert.throws(() => unpackEvidence(manifest, Buffer.alloc(16_000_001)));
});

await test("bounds total restored bytes when many paths reference the same large blob", () => {
  const bytes = Buffer.alloc(500_000);
  const paths = Array.from({ length: 40 }, (_, i) => [`source-${i}`, bytes]);
  assert.throws(() => packEvidence(new Map(paths)));
  const packed = packEvidence(new Map([["source", bytes]]));
  packed.manifest.entries = Object.fromEntries(
    paths.map(([path]) => [path, packed.manifest.entries.source]),
  );
  assert.throws(() => unpackEvidence(packed.manifest, packed.archive));
});
