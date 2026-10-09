import {
  env,
  reset,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

import { createEmailDeliveryPersistence } from "../../../packages/db/src/email-delivery.server.js";
import { createInvitationPersistence } from "../../../packages/db/src/invitations.server.js";
import {
  db,
  owner,
  seedCollaboration,
} from "../../../packages/db/test/support/collaboration-fixture.js";
import type { EmailDeliveryAuthority } from "../../dashboard/workers/email-delivery-authority.js";
import EmailDelivery from "../src/index.js";
import { sendInvitation } from "../src/provider.js";
import { invitationMessage } from "../src/template.js";
const authority = (
  env as unknown as { EMAIL_AUTHORITY: Service<EmailDeliveryAuthority> }
).EMAIL_AUTHORITY;
const base = {
  APP_ORIGIN: "https://dashboard.example.invalid",
  EMAIL_FROM: "noreply@example.invalid",
  EMAIL_SEND_ENABLED: "true",
};
beforeEach(seedCollaboration);
afterEach(async () => {
  vi.useRealTimers();
  await reset();
});
async function invite() {
  return createInvitationPersistence(db).create(owner, "team", {
    operationId: "op",
    email: "target@example.invalid",
    locale: "pt-BR",
  });
}
function worker(
  send: SendEmail["send"],
  overrides: Partial<ConstructorParameters<typeof EmailDelivery>[1]> = {},
) {
  const ctx = createExecutionContext();
  return {
    ctx,
    sender: new EmailDelivery(ctx, {
      ...base,
      EMAIL_AUTHORITY: authority,
      EMAIL: { send },
      EMAIL_JOBS: { send: vi.fn() } as unknown as Queue,
      ...overrides,
    }),
  };
}
function batch(body: unknown, id = "message") {
  return createMessageBatch("synthetic-jobs", [
    { id, timestamp: new Date(), attempts: 1, body },
  ]);
}
it("native private authority rejects forged jobs and sender has no D1 capability", async () => {
  expect(await authority.claim({ jobId: "forged" })).toBeNull();
  using rejected = authority.claim({ jobId: "forged", token: "synthetic" });
  await expect(Promise.resolve(rejected)).rejects.toThrow();
});
it("real D1 + private RPC + Queue ack only after provider result is durable", async () => {
  const i = await invite();
  const send = vi.fn(async (_payload: EmailMessageBuilder | EmailMessage) => ({
    messageId: "synthetic",
  }));
  const { sender, ctx } = worker(send);
  const messages = batch({ jobId: i.id });
  await sender.queue(messages);
  expect((await getQueueResult(messages, ctx)).explicitAcks).toEqual([
    "message",
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toMatchObject({
    to: "target@example.invalid",
  });
  expect(
    await db
      .prepare(
        "SELECT state,last_outcome,attempts FROM invitation_delivery_intent",
      )
      .first(),
  ).toEqual({ state: "completed", last_outcome: "accepted", attempts: 1 });
  const replay = batch({ jobId: i.id }, "replay");
  await sender.queue(replay);
  expect((await getQueueResult(replay, ctx)).explicitAcks).toEqual(["replay"]);
  expect(send).toHaveBeenCalledTimes(1);
});
it.each(["E_RATE_LIMIT_EXCEEDED", "E_RECIPIENT_SUPPRESSED", "timeout"])(
  "classifies %s without persisting sensitive provider errors",
  async (code) => {
    const i = await invite();
    const { sender, ctx } = worker(
      vi.fn(async () => {
        throw Object.assign(
          new Error("synthetic private recipient/token/body"),
          { code },
        );
      }),
    );
    const messages = batch({ jobId: i.id });
    await sender.queue(messages);
    expect((await getQueueResult(messages, ctx)).explicitAcks).toEqual([
      "message",
    ]);
    const outcome =
      code === "timeout"
        ? "unknown"
        : code === "E_RATE_LIMIT_EXCEEDED"
          ? "transient"
          : "permanent";
    expect(
      await db.prepare("SELECT outcome FROM email_delivery_attempt").first(),
    ).toEqual({ outcome });
    expect(
      JSON.stringify(
        await db.prepare("SELECT * FROM email_delivery_attempt").all(),
      ),
    ).not.toContain("private recipient");
  },
);
it("bad payloads are acknowledged individually; unavailable D1 is retried without an effect", async () => {
  const send = vi.fn(async (_payload: EmailMessageBuilder | EmailMessage) => ({
    messageId: "synthetic",
  }));
  const { sender, ctx } = worker(send, {
    EMAIL_AUTHORITY: {
      ...authority,
      claim: async () => {
        throw new Error("synthetic outage");
      },
    },
  });
  const bad = batch({ jobId: "forged", recipient: "secret" });
  await sender.queue(bad);
  expect((await getQueueResult(bad, ctx)).explicitAcks).toEqual(["message"]);
  const good = batch({ jobId: "forged" });
  await sender.queue(good);
  expect((await getQueueResult(good, ctx)).retryMessages).toHaveLength(1);
  expect(send).not.toHaveBeenCalled();
});
it("canceled claim cannot start; disabled sender neither claims nor spends budget", async () => {
  const i = await invite();
  const send = vi.fn(async (_payload: EmailMessageBuilder | EmailMessage) => ({
    messageId: "synthetic",
  }));
  const { sender, ctx } = worker(send, {
    EMAIL_AUTHORITY: {
      claim: (input) => authority.claim(input),
      record: (input) => authority.record(input),
      start: async (a) => {
        await createInvitationPersistence(db).cancel(owner, "team", i.id);
        return authority.start(a);
      },
    },
  });
  const messages = batch({ jobId: i.id });
  await sender.queue(messages);
  expect((await getQueueResult(messages, ctx)).explicitAcks).toEqual([
    "message",
  ]);
  expect(send).not.toHaveBeenCalled();
  const disabled = worker(send, { EMAIL_SEND_ENABLED: "false" });
  const retry = batch({ jobId: i.id });
  await disabled.sender.queue(retry);
  expect(
    (await getQueueResult(retry, disabled.ctx)).retryMessages,
  ).toHaveLength(1);
});
it("configuration failure is durable permanent failure without sending", async () => {
  const i = await invite();
  const send = vi.fn(async (_payload: EmailMessageBuilder | EmailMessage) => ({
    messageId: "synthetic",
  }));
  const { sender, ctx } = worker(send, {
    APP_ORIGIN: "https://attacker.invalid/path",
  });
  const messages = batch({ jobId: i.id });
  await sender.queue(messages);
  expect((await getQueueResult(messages, ctx)).explicitAcks).toEqual([
    "message",
  ]);
  expect(send).not.toHaveBeenCalled();
  expect(
    await db.prepare("SELECT state FROM invitation_delivery_intent").first(),
  ).toEqual({ state: "failed" });
});
it("unrecorded accepted result is retried, crash recovery can duplicate only the same invitation", async () => {
  const i = await invite();
  const send = vi.fn(async (_payload: EmailMessageBuilder | EmailMessage) => ({
    messageId: "synthetic",
  }));
  const { sender, ctx } = worker(send, {
    EMAIL_AUTHORITY: {
      claim: (input) => authority.claim(input),
      start: (input) => authority.start(input),
      record: async () => ({ recorded: false }),
    },
  });
  const messages = batch({ jobId: i.id });
  await sender.queue(messages);
  expect((await getQueueResult(messages, ctx)).retryMessages).toHaveLength(1);
  expect(
    await db.prepare("SELECT attempts FROM invitation_delivery_intent").first(),
  ).toEqual({ attempts: 1 });
  await db
    .prepare(
      "UPDATE invitation_delivery_intent SET lease_until=1,next_action_at=0,retry_at=0",
    )
    .run();
  await db.prepare("UPDATE email_delivery_attempt SET lease_until=1").run();
  await createEmailDeliveryPersistence(db).due();
  await db
    .prepare(
      "UPDATE invitation_delivery_intent SET next_action_at=0,retry_at=0",
    )
    .run();
  const recovered = worker(send);
  const replay = batch({ jobId: i.id }, "dlq-replay");
  await recovered.sender.queue(replay);
  expect((await getQueueResult(replay, recovered.ctx)).explicitAcks).toEqual([
    "dlq-replay",
  ]);
  expect(send).toHaveBeenCalledTimes(2);
  expect(
    await db.prepare("SELECT COUNT(*) n FROM workspace_invitation").first(),
  ).toEqual({ n: 1 });
  expect(
    await db
      .prepare("SELECT COUNT(*) n FROM membership WHERE user_id='target'")
      .first(),
  ).toEqual({ n: 0 });
});
it("timeouts persist unknown then preserve late acceptance", async () => {
  const i = await invite();
  let finish!: (v: EmailSendResult) => void;
  const send = vi.fn(
    () =>
      new Promise<EmailSendResult>((resolve) => {
        finish = resolve;
      }),
  );
  const { sender, ctx } = worker(send);
  const messages = batch({ jobId: i.id });
  vi.useFakeTimers();
  const processing = sender.queue(messages);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(15001);
  await processing;
  expect(
    await db.prepare("SELECT outcome FROM email_delivery_attempt").first(),
  ).toEqual({ outcome: "unknown" });
  finish({ messageId: "synthetic-late" });
  expect((await getQueueResult(messages, ctx)).explicitAcks).toEqual([
    "message",
  ]);
  expect(
    await db.prepare("SELECT outcome FROM email_delivery_attempt").first(),
  ).toEqual({ outcome: "accepted" });
});
it("wake reports Queue failure honestly and carries no recipient or template", async () => {
  const send = vi.fn(async (_payload: EmailMessageBuilder | EmailMessage) => ({
    messageId: "synthetic",
  }));
  const queue = vi.fn();
  const { sender } = worker(send, {
    EMAIL_JOBS: { send: queue } as unknown as Queue,
  });
  expect(await sender.wake({ operationId: "opaque" })).toEqual({
    status: "accepted",
  });
  expect(queue).toHaveBeenCalledWith({ jobId: "opaque" });
  queue.mockRejectedValue(new Error("synthetic"));
  expect(await sender.wake({ operationId: "opaque" })).toEqual({
    status: "unavailable",
  });
});
it("a short persistence outage retries the same known result without another provider call", async () => {
  const i = await invite();
  const send = vi.fn(async () => ({ messageId: "synthetic" }));
  let writes = 0;
  const { sender, ctx } = worker(send, {
    EMAIL_AUTHORITY: {
      claim: (input) => authority.claim(input),
      start: (input) => authority.start(input),
      record: (input) => {
        if (++writes === 1) throw new Error("synthetic D1 outage");
        return authority.record(input);
      },
    },
  });
  const messages = batch({ jobId: i.id });
  await sender.queue(messages);
  expect((await getQueueResult(messages, ctx)).explicitAcks).toEqual([
    "message",
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(writes).toBe(2);
});
it("DLQ replay remains terminal and logs only a bounded signal", async () => {
  const i = await invite();
  await createInvitationPersistence(db).cancel(owner, "team", i.id);
  const send = vi.fn(async () => ({ messageId: "synthetic" }));
  const { sender, ctx } = worker(send);
  const signal = vi.spyOn(console, "warn").mockImplementation(() => {});
  const messages = createMessageBatch("holon-email-dlq", [
    { id: "dlq", timestamp: new Date(), attempts: 99, body: { jobId: i.id } },
  ]);
  await sender.queue(messages);
  expect((await getQueueResult(messages, ctx)).explicitAcks).toEqual(["dlq"]);
  expect(send).not.toHaveBeenCalled();
  expect(signal).toHaveBeenCalledWith(
    JSON.stringify({ event: "email_dlq", messages: 1 }),
  );
  signal.mockRestore();
});
it.each(["en", "pt-BR"])(
  "%s HTML/text escape hostile workspace, links and headers; no tracking",
  (locale) => {
    const context = {
      jobId: "invite_safe",
      recipient: "target@example.invalid",
      locale,
      workspaceName: "<img src=x onerror=\"evil()\"> & 'quote'",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const message = invitationMessage(
      context,
      base.APP_ORIGIN,
      base.EMAIL_FROM,
    );
    expect(message.html).toContain("&lt;img");
    expect(message.html).not.toContain("<img");
    expect(message.html).not.toContain("<script");
    expect(message.text).toContain(context.workspaceName);
    expect(message.html).toContain(
      "https://dashboard.example.invalid/invitations/invite_safe",
    );
    expect(message).not.toHaveProperty("headers");
    expect(message).not.toHaveProperty("attachments");
    for (const origin of [
      "http://dashboard.invalid",
      "https://evil.invalid/path",
      "https://user:pass@dashboard.invalid",
      "javascript:evil()",
    ])
      expect(() =>
        invitationMessage(context, origin, base.EMAIL_FROM),
      ).toThrow();
    expect(() =>
      invitationMessage(
        {
          ...context,
          recipient: "valid@example.invalid\r\nBcc: injected@example.invalid",
        },
        base.APP_ORIGIN,
        base.EMAIL_FROM,
      ),
    ).toThrow();
    expect(() =>
      invitationMessage(
        context,
        base.APP_ORIGIN,
        "valid@example.invalid\r\nBcc: injected@example.invalid",
      ),
    ).toThrow();
  },
);
it("unrecognized or malformed provider acknowledgement remains unknown", async () => {
  const message = invitationMessage(
    {
      jobId: "invite_safe",
      recipient: "target@example.invalid",
      locale: "en",
      workspaceName: "Synthetic",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    base.APP_ORIGIN,
    base.EMAIL_FROM,
  );
  expect(
    await sendInvitation({ send: async () => ({ messageId: "" }) }, message),
  ).toBe("unknown");
  expect(
    await sendInvitation(
      {
        send: async () => {
          throw null;
        },
      },
      message,
    ),
  ).toBe("unknown");
  expect(
    await sendInvitation(
      {
        send: async () => {
          throw { code: 42 };
        },
      },
      message,
    ),
  ).toBe("unknown");
});
