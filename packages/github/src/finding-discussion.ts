import {
  positiveIntegerSchema,
  findingDiscussionCommentSchema,
  findingDiscussionPullRequestSchema,
  type FindingDiscussionComment,
  type FindingDiscussionPullRequest,
} from "@holon/contracts";

import type { ConfigurationGitTransport } from "./configuration-reader.js";

export interface FindingDiscussionReader {
  comment(id: number): Promise<FindingDiscussionComment>;
  pullRequest(number: number): Promise<FindingDiscussionPullRequest>;
}
export function createFindingDiscussionReader(
  transport: ConfigurationGitTransport,
  owner: string,
  repo: string,
): FindingDiscussionReader {
  return {
    async comment(id) {
      positiveIntegerSchema.parse(id);
      const result = findingDiscussionCommentSchema.parse(
        (
          await transport.request(
            "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}",
            { owner, repo, comment_id: id },
            200_000,
          )
        ).data,
      );
      if (result.id !== id) throw new TypeError("Comment identity mismatch");
      return result;
    },
    async pullRequest(number) {
      positiveIntegerSchema.parse(number);
      const result = findingDiscussionPullRequestSchema.parse(
        (
          await transport.request(
            "GET /repos/{owner}/{repo}/pulls/{pull_number}",
            { owner, repo, pull_number: number },
            200_000,
          )
        ).data,
      );
      if (result.number !== number)
        throw new TypeError("Pull request identity mismatch");
      return result;
    },
  };
}
