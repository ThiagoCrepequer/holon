import type { AdminRunProjectionEventV1 } from "@holon/contracts";

import { D1AdminStorage } from "./d1-adapter.js";
import { processAdminProjectionBatch } from "./queue-consumer.js";
import { processRetentionCleanup } from "./retention-handler.js";
import { handleConsoleRequest } from "./router.js";

export interface AdminEnv extends Env {
  readonly CF_ANALYTICS_API_TOKEN?: string;
  readonly CF_QUEUES_READ_TOKEN?: string;
  readonly PROJECTION_QUEUE_ID?: string;
  readonly PROJECTION_DLQ_ID?: string;
  readonly AUTHORIZED_EMAIL_DOMAIN?: string;
  readonly DEV_BYPASS_AUTH?: string;
  readonly DEV_USER_EMAIL?: string;
}

export async function handleAdminFetch(
  request: Request,
  env: AdminEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  return handleConsoleRequest(request, env, ctx);
}

export async function handleAdminQueue(
  batch: MessageBatch<AdminRunProjectionEventV1>,
  env: AdminEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  const storage = new D1AdminStorage(env.DB);
  await processAdminProjectionBatch(batch, storage);
}

export async function handleAdminScheduled(
  _controller: ScheduledController,
  env: AdminEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  const storage = new D1AdminStorage(env.DB);
  await processRetentionCleanup(storage);
}

export default {
  fetch: handleAdminFetch,
  queue: handleAdminQueue,
  scheduled: handleAdminScheduled,
} satisfies ExportedHandler<AdminEnv, AdminRunProjectionEventV1>;
