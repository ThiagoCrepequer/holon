import { githubAccessEventSchema } from "@holon/contracts/dashboard-collaboration";
import { createConnectionPersistence } from "@holon/db/identity/server";
import { WorkerEntrypoint } from "cloudflare:workers";
export class GitHubAccessEvents extends WorkerEntrypoint<{
  IDENTITY_DB: D1Database;
}> {
  async applyEvent(event: unknown): Promise<void> {
    await createConnectionPersistence(this.env.IDENTITY_DB).applyEvent(
      githubAccessEventSchema.parse(event),
    );
  }
  override fetch(): Response {
    return new Response(null, { status: 404 });
  }
}
