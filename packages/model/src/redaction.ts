import type { ModelReviewOutput } from "@holon/contracts";
import { redactSecrets } from "@holon/domain";
export { redactSecrets } from "@holon/domain";

export function limitUtf8Text(
  value: string,
  maximumBytes: number,
): { readonly content: string; readonly truncated: boolean } {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError("maximumBytes must be a non-negative safe integer");
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maximumBytes) {
    return { content: value, truncated: false };
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = maximumBytes; end >= 0; end -= 1) {
    try {
      return {
        content: decoder.decode(bytes.slice(0, end)),
        truncated: true,
      };
    } catch {
      // Move back to the previous complete UTF-8 code point.
    }
  }
  return { content: "", truncated: true };
}

export function redactModelReviewOutput(
  output: ModelReviewOutput,
): ModelReviewOutput {
  return {
    ...(output.resolutions !== undefined
      ? {
          resolutions: output.resolutions.map((resolution) => ({
            ...resolution,
            diagnostic: redactSecrets(resolution.diagnostic),
            evidence: resolution.evidence.map((evidence) => ({
              ...evidence,
              excerpt: redactSecrets(evidence.excerpt),
              reason: redactSecrets(evidence.reason),
            })),
          })),
        }
      : {}),
    ...(output.isDegraded !== undefined
      ? { isDegraded: output.isDegraded }
      : {}),
    ...(output.outputLimitations?.length
      ? { outputLimitations: output.outputLimitations }
      : {}),
    findings: output.findings.map((finding) => ({
      ...finding,
      diagnostic: redactSecrets(finding.diagnostic),
      evidence: finding.evidence.map((evidence) => ({
        ...evidence,
        excerpt: redactSecrets(evidence.excerpt),
        reason: redactSecrets(evidence.reason),
      })),
      ...(finding.suggestion === undefined
        ? {}
        : { suggestion: redactSecrets(finding.suggestion) }),
    })),
    summary: redactSecrets(output.summary),
  };
}
