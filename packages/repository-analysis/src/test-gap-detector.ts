import type { TestGapSignal } from "@holon/contracts";

const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
]);

function isTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.includes("__tests__") ||
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.endsWith("_test.go") ||
    lower.endsWith("_test.py") ||
    lower.includes("test_")
  );
}

function isSourceFile(path: string): boolean {
  if (isTestFile(path)) return false;
  const lower = path.toLowerCase();
  if (
    lower.includes("fixture") ||
    lower.includes("mock") ||
    lower.includes(".d.ts") ||
    lower.endsWith(".json") ||
    lower.endsWith(".md") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".yaml")
  ) {
    return false;
  }
  return Array.from(sourceExtensions).some((ext) => lower.endsWith(ext));
}

function deriveExpectedTestPath(sourcePath: string): string {
  if (sourcePath.endsWith(".go")) {
    return sourcePath.replace(/\.go$/u, "_test.go");
  }
  if (sourcePath.endsWith(".py")) {
    const filename = sourcePath.split("/").pop() ?? "";
    return `tests/test_${filename}`;
  }
  if (sourcePath.endsWith(".rs")) {
    const filename = sourcePath.split("/").pop()?.replace(/\.rs$/u, "") ?? "";
    return `tests/${filename}.rs`;
  }
  if (sourcePath.endsWith(".java")) {
    return sourcePath.replace(/(\w+)\.java$/u, "$1Test.java");
  }
  // TypeScript / JavaScript (.ts, .tsx, .js, .jsx, .mjs, .cjs)
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(sourcePath)) {
    return sourcePath.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/u, ".test.ts");
  }
  // Safe generic fallback: replaces extension with .test.<ext>
  return sourcePath.replace(/(\.[^.]+)$/u, ".test$1");
}

export function detectTestGaps(
  files: readonly { readonly patch: string; readonly path: string }[],
): readonly TestGapSignal[] {
  const testFiles = files.filter((f) => isTestFile(f.path));
  const sourceFiles = files.filter((f) => isSourceFile(f.path));

  // If there are no source code changes, no test gap
  if (sourceFiles.length === 0) return [];

  const gaps: TestGapSignal[] = [];

  for (const source of sourceFiles) {
    const expected = deriveExpectedTestPath(source.path);
    const hasMatchingTest = testFiles.some(
      (testFile) =>
        testFile.path === expected ||
        testFile.path.includes(source.path.replace(/\.[^.]+$/u, "")),
    );

    if (!hasMatchingTest) {
      gaps.push({
        expectedTestPathPattern: expected,
        reason: "no_test_file_modified",
        sourcePath: source.path,
      });
    }
  }

  return gaps;
}
