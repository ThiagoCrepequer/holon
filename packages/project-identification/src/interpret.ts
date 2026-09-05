import type {
  ProjectIdentificationCache,
  ProjectIdentificationModel,
} from "@holon/application";
import type { ProjectIdentificationResultV1 } from "@holon/contracts";

import { verifyInterpretation } from "./validation.js";
export async function interpretProjects(
  input: ProjectIdentificationResultV1,
  options: {
    cache: ProjectIdentificationCache;
    model: ProjectIdentificationModel;
    owner: string;
    now?: () => number;
    deadlineAt?: number;
    onAttempt?: () => void;
  },
): Promise<ProjectIdentificationResultV1> {
  const now = options.now ?? Date.now;
  const deadline = Math.min(options.deadlineAt ?? Infinity, now() + 120000);
  let calls = 0;
  const projects: ProjectIdentificationResultV1["projects"] = [];
  for (const project of input.projects) {
    if (now() >= deadline) {
      projects.push({
        ...project,
        status: "partial",
        limitations: [...project.limitations, "identification-deadline"],
      });
      continue;
    }
    const claim = await options.cache.claim(project.fingerprint, options.owner);
    if (claim.status === "hit") {
      projects.push(claim.project);
      continue;
    }
    if (claim.status !== "claimed" || calls >= 8) {
      projects.push({
        ...project,
        status: "partial",
        limitations: [
          ...project.limitations,
          claim.status === "pending"
            ? "identification-pending"
            : "identification-unavailable",
        ],
      });
      continue;
    }
    let verified = false;
    for (
      let attempt = 0;
      attempt < 2 && calls < 8 && now() < deadline;
      attempt++
    ) {
      if (
        !(await options.cache.attempt(
          project.fingerprint,
          options.owner,
          claim.token,
        ))
      )
        break;
      calls++;
      options.onAttempt?.();
      try {
        const result = verifyInterpretation(
          project,
          await options.model.identify(
            project,
            AbortSignal.timeout(Math.min(30000, Math.max(1, deadline - now()))),
          ),
        );
        if (
          await options.cache.complete(
            project.fingerprint,
            options.owner,
            claim.token,
            result,
          )
        ) {
          projects.push(result);
          verified = true;
        }
        break;
      } catch {
        /* Untrusted provider output is never logged or persisted. */
      }
    }
    if (!verified) {
      await options.cache.fail(project.fingerprint, options.owner, claim.token);
      projects.push({
        ...project,
        status: "partial",
        limitations: [...project.limitations, "model-unavailable"],
      });
    }
  }
  return {
    ...input,
    projects,
    status:
      input.status === "complete" &&
      projects.every((p) => p.status === "complete")
        ? "complete"
        : "partial",
  };
}
