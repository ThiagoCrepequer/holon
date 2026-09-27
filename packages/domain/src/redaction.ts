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
