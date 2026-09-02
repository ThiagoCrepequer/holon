import { describe, expect, it } from "vitest";

import {
  computeStableFingerprint,
  normalizeDiagnostic,
  normalizeExcerpt,
} from "../src/fingerprint.js";

describe("fingerprint", () => {
  describe("normalizeExcerpt", () => {
    it("trims lines and collapses whitespace", () => {
      const raw = `
        const token   =   auth.getToken();
          if (!token) {
            throw new Error("Missing token");
          }
      `;
      const normalized = normalizeExcerpt(raw);
      expect(normalized).toBe(
        'const token = auth.getToken(); if (!token) { throw new Error("Missing token"); }',
      );
    });

    it("handles carriage returns and tabs", () => {
      const raw = "\tconst x = 1;\r\n\tconst y = 2;\r\n";
      expect(normalizeExcerpt(raw)).toBe("const x = 1; const y = 2;");
    });
  });

  describe("normalizeDiagnostic", () => {
    it("removes line number references and lowercases", () => {
      const diag1 = "Security vulnerability at line 42 in query execution.";
      const diag2 = "Security vulnerability on lines 10-15 in query execution.";
      expect(normalizeDiagnostic(diag1)).toBe(
        "security vulnerability in query execution.",
      );
      expect(normalizeDiagnostic(diag2)).toBe(
        "security vulnerability in query execution.",
      );
    });
  });

  describe("computeStableFingerprint", () => {
    it("generates a canonical fp: SHA-256 fingerprint", async () => {
      const fp = await computeStableFingerprint({
        diagnostic: "Unescaped user input passed to raw SQL query.",
        excerpt: "db.query(rawSql)",
        path: "src/db/query.ts",
      });
      expect(fp).toMatch(/^fp:[a-f0-9]{64}$/u);
    });

    it("is invariant to formatting whitespace and line numbers", async () => {
      const fp1 = await computeStableFingerprint({
        diagnostic: "Unescaped user input passed to raw SQL query at line 45.",
        excerpt: "  db.query(rawSql); \n ",
        path: "src/db/query.ts",
      });

      const fp2 = await computeStableFingerprint({
        diagnostic: "Unescaped user input passed to raw SQL query on line 120.",
        excerpt: "\tdb.query(rawSql);\r\n",
        path: "src/db/query.ts",
      });

      expect(fp1).toBe(fp2);
    });

    it("distinguishes different files or diagnostics", async () => {
      const fp1 = await computeStableFingerprint({
        diagnostic: "Unescaped user input passed to raw SQL query.",
        excerpt: "db.query(rawSql)",
        path: "src/db/query.ts",
      });

      const fp2 = await computeStableFingerprint({
        diagnostic: "Unescaped user input passed to raw SQL query.",
        excerpt: "db.query(rawSql)",
        path: "src/db/other.ts",
      });

      const fp3 = await computeStableFingerprint({
        diagnostic: "Hardcoded secret exposed in configuration.",
        excerpt: "db.query(rawSql)",
        path: "src/db/query.ts",
      });

      expect(fp1).not.toBe(fp2);
      expect(fp1).not.toBe(fp3);
    });

    it("incorporates ruleId when present", async () => {
      const fpWithRule = await computeStableFingerprint({
        diagnostic: "Unescaped user input passed to raw SQL query.",
        excerpt: "db.query(rawSql)",
        path: "src/db/query.ts",
        ruleId: "security/sql-injection",
      });

      const fpWithoutRule = await computeStableFingerprint({
        diagnostic: "Unescaped user input passed to raw SQL query.",
        excerpt: "db.query(rawSql)",
        path: "src/db/query.ts",
      });

      expect(fpWithRule).not.toBe(fpWithoutRule);
    });
  });
});
