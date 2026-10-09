import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const maximumBytes = 16_000_000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function checkPath(path) {
  assert(typeof path === "string" && path.length > 0 && path.length <= 1024);
  assert(!path.includes("\\") && !path.includes("\0"));
  assert(!posix.isAbsolute(path) && posix.normalize(path) === path);
  assert(path !== "." && !path.split("/").includes(".."));
}

// The manifest stays readable; the archive stores one byte sequence per digest.
export function packEvidence(files) {
  assert(files.size > 0 && files.size <= 1000);
  const entries = Object.create(null);
  const blobs = Object.create(null);
  let totalBytes = 0;
  for (const [path, bytes] of [...files].toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    checkPath(path);
    assert(Buffer.isBuffer(bytes));
    totalBytes += bytes.length;
    assert(totalBytes <= maximumBytes);
    const sha256 = digest(bytes);
    entries[path] = { sha256, bytes: bytes.length };
    blobs[sha256] = bytes.toString("base64");
  }
  const expanded = Buffer.from(JSON.stringify(blobs));
  assert(expanded.length <= maximumBytes);
  const archive = gzipSync(expanded, { level: 9 });
  return {
    manifest: {
      archive: {
        sha256: digest(archive),
        bytes: archive.length,
        expandedBytes: expanded.length,
      },
      blobCount: Object.keys(blobs).length,
      entries,
    },
    archive,
  };
}

export function unpackEvidence(manifest, archive) {
  assert(Buffer.isBuffer(archive) && archive.length <= maximumBytes);
  assert.equal(archive.length, manifest.archive.bytes);
  assert.equal(digest(archive), manifest.archive.sha256);
  const expanded = gunzipSync(archive, { maxOutputLength: maximumBytes });
  assert.equal(expanded.length, manifest.archive.expandedBytes);
  const blobs = JSON.parse(expanded.toString("utf8"));
  const contents = new Map();
  for (const [sha256, encoded] of Object.entries(blobs)) {
    assert(/^[a-f0-9]{64}$/u.test(sha256));
    assert(typeof encoded === "string");
    const bytes = Buffer.from(encoded, "base64");
    assert.equal(bytes.toString("base64"), encoded);
    assert.equal(digest(bytes), sha256);
    contents.set(sha256, bytes);
  }
  assert.equal(contents.size, manifest.blobCount);
  const files = new Map();
  const used = new Set();
  let totalBytes = 0;
  const entries = Object.entries(manifest.entries);
  assert(entries.length > 0 && entries.length <= 1000);
  for (const [path, entry] of entries) {
    checkPath(path);
    const bytes = contents.get(entry.sha256);
    assert(bytes, `Missing evidence: ${path}`);
    assert.equal(bytes.length, entry.bytes);
    totalBytes += bytes.length;
    assert(totalBytes <= maximumBytes);
    files.set(path, Buffer.from(bytes));
    used.add(entry.sha256);
  }
  assert.equal(used.size, contents.size, "Unreferenced evidence");
  return files;
}
