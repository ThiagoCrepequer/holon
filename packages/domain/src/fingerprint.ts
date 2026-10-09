/// <reference lib="dom" />

import type { FindingEvidence } from "./finding.js";
import type { FindingFingerprint } from "./identity.js";

/** A secondary, versioned identity; only an unambiguous match may reuse an ID. */
export async function computeEvidenceFingerprint(
  anchorPath: string,
  evidence: readonly FindingEvidence[],
): Promise<string> {
  const canonical = JSON.stringify([
    "evidence",
    anchorPath,
    [
      ...new Set(
        evidence.map((item) =>
          JSON.stringify([item.path, normalizeExcerpt(item.excerpt)]),
        ),
      ),
    ].toSorted(),
  ]);
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical),
      ),
    ),
  );
}

export interface StableFingerprintInput {
  readonly diagnostic: string;
  readonly excerpt: string;
  readonly path: string;
  readonly ruleId?: string | undefined;
}

/**
 * Only platform line endings are equivalent. Literals, indentation and blank
 * lines are semantic data; formatting changes conservatively invalidate reuse.
 */
export function normalizeExcerpt(excerpt: string): string {
  return excerpt.replaceAll("\r\n", "\n");
}

/**
 * Normalizes diagnostic messages by removing ephemeral line number citations
 * (e.g., "at line 42", "on line 105") and collapsing whitespace.
 */
export function normalizeDiagnostic(diagnostic: string): string {
  return diagnostic
    .trim()
    .replaceAll(/\b(?:at|on|in)\s+lines?\s+\d+(?:-\d+)?\b/giu, "")
    .replaceAll(/\s+/gu, " ")
    .toLowerCase();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Computes a deterministic, line-independent finding fingerprint following SARIF 2.1.0 principles.
 */
export async function computeStableFingerprint(
  input: StableFingerprintInput,
): Promise<FindingFingerprint> {
  const normalizedPath = input.path.trim().replaceAll("\\", "/");
  const normalizedEx = normalizeExcerpt(input.excerpt);
  const normalizedDiag = normalizeDiagnostic(input.diagnostic);
  const rule = input.ruleId?.trim() ?? "";

  const canonical = JSON.stringify([
    normalizedPath,
    rule,
    normalizedEx,
    normalizedDiag,
  ]);

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );

  return `fp:${bytesToHex(new Uint8Array(digest))}`;
}
