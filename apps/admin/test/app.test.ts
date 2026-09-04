import type { AdminRunProjectionEventV1 } from "@holon/contracts";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import app, {
  handleAdminFetch,
  handleAdminQueue,
  handleAdminScheduled,
} from "../workers/app.js";
import { setupTestDatabase } from "./helpers.js";

describe("apps/admin worker composition", () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });

  it("exports fetch, queue and scheduled handlers on default export", () => {
    expect(typeof app.fetch).toBe("function");
    expect(typeof app.queue).toBe("function");
    expect(typeof app.scheduled).toBe("function");
  });

  it("handles /health route via fetch without authentication", async () => {
    const request = new Request("http://localhost/health");
    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const response = await handleAdminFetch(request, env, ctx);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { status: string };
    expect(json.status).toBe("ok");
  });

  it("enforces Access JWT authentication on root fetch", async () => {
    const unauthRequest = new Request("http://localhost/");
    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const unauthResponse = await handleAdminFetch(unauthRequest, env, ctx);
    expect(unauthResponse.status).toBe(401);
  });

  it("handles queue batch by acknowledging messages", async () => {
    const ackMock = vi.fn();
    const batch = {
      messages: [
        {
          ack: ackMock,
          body: {} as AdminRunProjectionEventV1,
          id: "msg-1",
          retry: vi.fn(),
          timestamp: new Date(),
        },
      ],
      queue: "holon-admin-projections",
    } as unknown as MessageBatch<AdminRunProjectionEventV1>;

    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    await handleAdminQueue(batch, env, ctx);
    expect(ackMock).toHaveBeenCalledOnce();
  });

  it("handles scheduled invocation without error", async () => {
    const controller = {
      cron: "* * * * *",
      noRetry: vi.fn(),
      scheduledTime: Date.now(),
    } as unknown as ScheduledController;

    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    await expect(
      handleAdminScheduled(controller, env, ctx),
    ).resolves.toBeUndefined();
  });
});
