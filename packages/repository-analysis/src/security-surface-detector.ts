import type {
  SecuritySurfaceKind,
  SecuritySurfaceSignal,
} from "@holon/contracts";
import { parsePatch } from "diff";

const dependencyManifests = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "cargo.toml",
  "requirements.txt",
  "go.mod",
  "pom.xml",
  "build.gradle",
]);

const securityPatterns: readonly {
  readonly kind: SecuritySurfaceKind;
  readonly regex: RegExp;
}[] = [
  {
    kind: "secret_or_env_access",
    regex:
      /\b(?:process\.env\.[A-Z0-9_]+|os\.environ(?:\[|\.get\()|os\.Getenv\b|System\.getenv\b|API_KEY|AUTH_SECRET|PRIVATE_KEY|TOKEN)\b/u,
  },
  {
    kind: "network_egress",
    regex:
      /(?:\bfetch\s*\(|\baxios(?:\.[a-z]+)?\s*\(|\brequests\.(?:get|post|put|delete)\s*\(|\bhttp\.(?:Get|Post)\b|\bnet\/http\b|\breqwest\b)/u,
  },
];

function isDependencyManifest(path: string): boolean {
  const filename = path.split("/").pop()?.toLowerCase() ?? "";
  return dependencyManifests.has(filename);
}

export function detectSecuritySurfaces(
  files: readonly { readonly patch: string; readonly path: string }[],
): readonly SecuritySurfaceSignal[] {
  const signals: SecuritySurfaceSignal[] = [];

  for (const file of files) {
    const isManifest = isDependencyManifest(file.path);

    let patches;
    try {
      patches = parsePatch(file.patch);
    } catch {
      continue;
    }

    for (const patch of patches) {
      for (const hunk of patch.hunks ?? []) {
        let newLine = hunk.newStart;

        for (const rawLine of hunk.lines) {
          if (rawLine.startsWith("+")) {
            const addedText = rawLine.slice(1).trim();

            if (isManifest && addedText.length > 0) {
              // Check if adding a dependency
              if (
                /["'][a-zA-Z0-9@/._-]+["']\s*:\s*["'][~^0-9]/u.test(
                  addedText,
                ) ||
                /^[a-zA-Z0-9_-]+\s*==\s*[0-9]/u.test(addedText) ||
                /^\s*(?:require|import)\s+[a-zA-Z0-9/._-]+/u.test(addedText)
              ) {
                signals.push({
                  excerpt: addedText.slice(0, 300),
                  kind: "new_dependency",
                  line: newLine,
                  path: file.path,
                });
              }
            }

            // Check security and egress patterns
            for (const pattern of securityPatterns) {
              if (pattern.regex.test(addedText)) {
                signals.push({
                  excerpt: addedText.slice(0, 300),
                  kind: pattern.kind,
                  line: newLine,
                  path: file.path,
                });
                break;
              }
            }

            newLine += 1;
          } else if (!rawLine.startsWith("-")) {
            newLine += 1;
          }
        }
      }
    }
  }

  return signals;
}
