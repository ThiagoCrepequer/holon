import { createHash } from "node:crypto";

import { runIdSchema } from "@holon/contracts";

const maximumSandboxIdLength = 63;
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
const runCoordinates =
  /^github:(?<repositoryId>\d+):pr:(?<pullRequestNumber>\d+):head:(?<headSha>[a-f0-9]{40}):base:(?<baseSha>[a-f0-9]{40})$/u;

interface DurableObjectIdentityNamespace {
  idFromName(name: string): { toString(): string };
}

function compactCoordinate(value: string, name: string): string {
  const coordinate = BigInt(value);
  if (coordinate <= 0n || coordinate > maximumSafeInteger) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return coordinate.toString(36);
}

export function createSandboxId(rawRunId: string): string {
  const runId = runIdSchema.parse(rawRunId);
  const groups = runCoordinates.exec(runId)?.groups;
  if (groups === undefined) throw new TypeError("Unable to parse run ID");

  compactCoordinate(groups.repositoryId!, "repositoryId");
  compactCoordinate(groups.pullRequestNumber!, "pullRequestNumber");
  return `r-${createHash("sha256")
    .update(runId)
    .digest("hex")
    .slice(0, maximumSandboxIdLength - 2)}`;
}

export function resolveContainerId(
  namespace: DurableObjectIdentityNamespace,
  runId: string,
): string {
  const containerId = namespace.idFromName(createSandboxId(runId)).toString();
  if (!/^[a-f0-9]{64}$/u.test(containerId)) {
    throw new TypeError("Container Durable Object ID is invalid");
  }
  return containerId;
}
