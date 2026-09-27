import { zipSync } from "fflate";
import { expect, it } from "vitest";

import {
  extractSafeZipArtifact,
  ingestRawArtifactFiles,
  parseJUnitXml,
} from "../src/index.js";
it("does not treat arbitrary XML as a zero-test report", () => {
  expect(
    ingestRawArtifactFiles([{ path: "pom.xml", content: "<project/>" }]).status,
  ).toBe("not_available");
});
it("decodes XML messages and rejects malformed report structure", () => {
  const report = parseJUnitXml(
    '<testsuite><testcase name="a &amp; b"><failure message="expected &lt;value&gt;"/></testcase></testsuite>',
  );
  expect(report.failures[0]).toMatchObject({
    testName: "a & b",
    message: "expected <value>",
  });
  expect(() => parseJUnitXml('<testsuite><testcase name="broken"/>')).toThrow();
});
it("enforces inflated bytes while reading a ZIP and rejects excess file counts", () => {
  const bytes = zipSync({
    "a.xml": new TextEncoder().encode("x".repeat(100000)),
  });
  expect(() =>
    extractSafeZipArtifact(bytes, { maxUncompressedBytes: 100 }),
  ).toThrow();
  expect(() =>
    extractSafeZipArtifact(
      zipSync({ "a.xml": new Uint8Array([1]), "b.xml": new Uint8Array([1]) }),
      { maxFilesExtracted: 1 },
    ),
  ).toThrow();
});
