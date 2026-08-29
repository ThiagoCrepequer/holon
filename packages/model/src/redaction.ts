import type { ModelReviewOutput } from "@holon/contracts";

const redactedSecret = "[REDACTED_SECRET]";

const secretPatterns = [
  /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/gu,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/gu,
  /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\bAIza[0-9A-Za-z_-]{30,}\b/gu,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
] as const;

const quotedSecretAssignment =
  /\b(api[_-]?key|client[_-]?secret|password|private[_-]?key|secret|token)(\s*[:=]\s*)(["'`])([^\n"'`]{8,})(\3)/giu;

export function redactSecrets(value: string): string {
  let redacted = value;
  for (const pattern of secretPatterns) {
    redacted = redacted.replaceAll(pattern, redactedSecret);
  }
  return redacted.replaceAll(
    quotedSecretAssignment,
    (match, name: string, separator: string, quote: string, secret: string) => {
      if (
        secret === redactedSecret ||
        /^(?:process\.)?env\.|^\$\{|^(?:response|result)\./u.test(secret)
      ) {
        return match;
      }
      return `${name}${separator}${quote}${redactedSecret}${quote}`;
    },
  );
}

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
