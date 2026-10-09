import {
  coreReviewDetailInputSchema,
  coreReviewDetailResultSchema,
} from "@holon/contracts/dashboard-reviews";
import { WorkerEntrypoint } from "cloudflare:workers";
/** Service binding only. HTTP and human ACL belong to dashboard; core validates canonical PR coordinates. */
export class DashboardReviewReader extends WorkerEntrypoint<Cloudflare.Env> {
  async detail(raw: unknown) {
    const input = coreReviewDetailInputSchema.parse(raw);
    const key = `github:${input.repositoryId}:pr:${input.pullRequestNumber}`;
    return coreReviewDetailResultSchema.parse(
      await this.env.REVIEW_LEDGERS.getByName(key).reviewDetail(input),
    );
  }
}
