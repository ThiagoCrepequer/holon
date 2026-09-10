import type { ReviewJob } from "@holon/contracts";
import { reviewMessage, type ReviewLanguage } from "@holon/domain";
import {
  classifyFindingPublication,
  createPrKey,
  type Finding,
  type ReviewRun,
  type RunId,
} from "@holon/domain";

import { selectFindingsWithCanonicalEvidence } from "./evidence.js";
import type { ReviewContext } from "./ports.js";
import { fitPublicationSummary } from "./publication-summary.js";

export function createReviewRun(job: ReviewJob): ReviewRun {
  return {
    attempt: 0,
    causalVersion: job.envelope.pullRequest.updatedAt,
    createdAt: job.envelope.receivedAt,
    id: job.runId as RunId,
    prKey: createPrKey({
      provider: "github",
      pullRequestNumber: job.envelope.pullRequest.number,
      repositoryId: job.envelope.repository.id,
    }),
    state: "queued",
  };
}

export function renderFinding(
  finding: Finding,
  language: ReviewLanguage = "en",
): string {
  const suggestion =
    finding.suggestion === undefined
      ? ""
      : `\n\n${reviewMessage(language, "suggestedAction")}: ${finding.suggestion}`;
  const evidence = finding.evidence
    .map((item) => {
      const range =
        item.endLine === undefined || item.endLine === item.startLine
          ? `${item.startLine}`
          : `${item.startLine}-${item.endLine}`;
      const excerpt = item.excerpt;
      return `- ${item.path}:${range} — ${item.reason}: ${excerpt}`;
    })
    .join("\n");
  return `${finding.diagnostic}${suggestion}\n\n${reviewMessage(language, "evidence")}:\n${evidence}`;
}

export function selectValidFindings(
  candidates: readonly Finding[],
  context: ReviewContext,
): readonly Finding[] {
  return selectFindingsWithCanonicalEvidence(candidates, context);
}

export function composeReviewSummary(
  summary: string,
  findings: readonly Finding[],
  partial: boolean,
): string {
  const sections: string[] = [];
  if (partial) {
    sections.push(
      "Partial review: at least one eligible patch or context section was omitted by a deterministic host budget.",
    );
  }
  const lowSeverity = findings.filter(
    (finding) => classifyFindingPublication(finding) === "summary_only",
  );
  if (lowSeverity.length > 0) {
    sections.push(
      [
        "Low-severity observations:",
        ...lowSeverity.map((finding) => `- ${finding.diagnostic}`),
      ].join("\n"),
    );
  }
  return fitPublicationSummary("", summary, sections.join("\n\n"));
}
