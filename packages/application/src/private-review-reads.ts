import {
  privateReviewPageSchema,
  privateReviewDetailSchema,
  reviewListInputSchema,
  reviewDetailInputSchema,
  type PrivateReviewPage,
  type PrivateReviewDetail,
  type ReviewListInput,
  type ReviewDetailInput,
} from "@holon/contracts/dashboard-reviews";

import type { AuthorizedReviewScope } from "./dashboard-ports.js";

export class PrivateReviewError extends Error {
  constructor(
    public readonly code: "denied" | "invalid_request" | "unavailable",
  ) {
    super(code);
    this.name = "PrivateReviewError";
  }
}
export interface PrivateReviewReadPorts {
  authorize(
    workspaceId: string,
  ): Promise<AuthorizedReviewScope & { sessionId: string }>;
  list(input: ReviewListInput): Promise<PrivateReviewPage>;
  detail(input: ReviewDetailInput): Promise<PrivateReviewDetail>;
}
/** ACL is repeated after asynchronous storage/core I/O, including current session identity. */
export function createPrivateReviewReads(ports: PrivateReviewReadPorts) {
  async function read<T>(
    input: ReviewListInput | ReviewDetailInput,
    operation: () => Promise<T>,
  ): Promise<T> {
    const before = await ports.authorize(input.workspaceId);
    const allowed = (scope: AuthorizedReviewScope) =>
      scope.repositories.some(
        (x) =>
          x.installationId === input.installationId &&
          x.repositoryId === input.repositoryId,
      );
    if (!allowed(before)) throw new PrivateReviewError("denied");
    const result = await operation();
    const after = await ports.authorize(input.workspaceId);
    if (
      before.userId !== after.userId ||
      before.sessionId !== after.sessionId ||
      !allowed(after)
    )
      throw new PrivateReviewError("denied");
    return result;
  }
  return {
    async list(raw: unknown) {
      const parsed = reviewListInputSchema.safeParse(raw);
      if (!parsed.success) throw new PrivateReviewError("invalid_request");
      return read(parsed.data, async () => {
        const result = privateReviewPageSchema.parse(
          await ports.list(parsed.data),
        );
        if (
          result.items.some(
            (row) =>
              row.installationId !== parsed.data.installationId ||
              row.repositoryId !== parsed.data.repositoryId,
          )
        )
          throw new PrivateReviewError("unavailable");
        return result;
      });
    },
    async detail(raw: unknown) {
      const parsed = reviewDetailInputSchema.safeParse(raw);
      if (!parsed.success) throw new PrivateReviewError("invalid_request");
      return read(parsed.data, async () => {
        const result = privateReviewDetailSchema.parse(
          await ports.detail(parsed.data),
        );
        if (
          result.review.installationId !== parsed.data.installationId ||
          result.review.repositoryId !== parsed.data.repositoryId ||
          result.review.pullRequestNumber !== parsed.data.pullRequestNumber
        )
          throw new PrivateReviewError("unavailable");
        return result;
      });
    },
  };
}
