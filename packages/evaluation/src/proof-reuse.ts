export interface ReviewProofDependencies {
  readonly installationId: number;
  readonly repositoryId: number;
  readonly memoryDigest: string;
  readonly feedbackDigest: string;
  readonly baseSha: string;
  readonly configurationDigest: string;
  readonly promptDigest: string;
  readonly modelReference: string;
  readonly capabilityDigest: string;
  readonly graphComplete: boolean;
  readonly completeReview: boolean;
  readonly dependencies: Readonly<Record<string, string>>;
}

/** Shadow experiment only: exact dependency closure is required before considering reuse. */
export function reviewProofReuseDecision(
  previous: ReviewProofDependencies,
  current: ReviewProofDependencies,
): { readonly reusable: boolean; readonly reason: string } {
  if (
    !previous.graphComplete ||
    !current.graphComplete ||
    !previous.completeReview ||
    !current.completeReview
  )
    return { reusable: false, reason: "incomplete_proof" };
  for (const key of [
    "installationId",
    "repositoryId",
    "memoryDigest",
    "feedbackDigest",
    "baseSha",
    "configurationDigest",
    "promptDigest",
    "modelReference",
    "capabilityDigest",
  ] as const)
    if (previous[key] !== current[key]) return { reusable: false, reason: key };
  const dependencies = Object.keys(previous.dependencies).toSorted();
  if (
    dependencies.length === 0 ||
    dependencies.join("\n") !==
      Object.keys(current.dependencies).toSorted().join("\n")
  )
    return { reusable: false, reason: "dependency_set" };
  if (
    dependencies.some(
      (path) => previous.dependencies[path] !== current.dependencies[path],
    )
  )
    return { reusable: false, reason: "dependency_content" };
  return { reusable: true, reason: "complete_dependency_match" };
}
