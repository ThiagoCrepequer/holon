import { canonicalConfigurationJson } from "@holon/application";
import {
  memoryRuleSchema,
  type MemoryObservation,
  type MemoryRule,
} from "@holon/contracts";
import { redactSecrets } from "@holon/domain";

export async function memoryDigest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalConfigurationJson(value)),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function createMemoryRule(input: {
  root: string;
  guidance: string;
  topic: string;
  evidence: MemoryObservation[];
  createdAt: string;
  expiresAt: string;
  supersedes?: string;
}): Promise<MemoryRule> {
  const content = {
    ...input,
    guidance: redactSecrets(input.guidance),
    createdAt: new Date(input.createdAt).toISOString(),
    expiresAt: new Date(input.expiresAt).toISOString(),
    evidence: input.evidence.map((item) => ({
      ...item,
      summary: redactSecrets(item.summary),
      ...(item.feedbackReason
        ? { feedbackReason: redactSecrets(item.feedbackReason) }
        : {}),
    })),
  };
  const digest = await memoryDigest(content);
  return memoryRuleSchema.parse({
    ...content,
    id: digest,
    digest,
    state: "proposed",
  });
}
