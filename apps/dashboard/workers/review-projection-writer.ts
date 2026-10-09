import { createProjectionPersistence } from "@holon/db/projection/server";
import { WorkerEntrypoint } from "cloudflare:workers";
/** Private producer binding; no public recovery or projection-write HTTP route. */
export class ReviewProjectionWriter extends WorkerEntrypoint<{
  PROJECTION_DB: D1Database;
}> {
  write(raw: unknown) {
    return createProjectionPersistence(this.env.PROJECTION_DB).write(raw);
  }
  beginRecovery(raw: unknown) {
    return createProjectionPersistence(this.env.PROJECTION_DB).beginRecovery(
      raw,
    );
  }
  activateRecovery(raw: unknown) {
    return createProjectionPersistence(this.env.PROJECTION_DB).activateRecovery(
      raw,
    );
  }
}
