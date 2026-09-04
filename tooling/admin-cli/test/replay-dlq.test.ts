import { describe, expect, it, vi } from "vitest";

import {
  parseReplayDlqArgs,
  QueuesHttpClient,
  replayDlq,
  runCli,
} from "../replay-dlq.js";

describe("replay-dlq tool", () => {
  describe("parseReplayDlqArgs", () => {
    it("parses default options in dry-run mode", () => {
      const config = parseReplayDlqArgs([]);
      expect(config.execute).toBe(false);
      expect(config.dryRun).toBe(true);
      expect(config.batchSize).toBe(10);
      expect(config.visibilityTimeout).toBe(300);
      expect(config.limit).toBeUndefined();
    });

    it("requires --limit when --execute is specified", () => {
      expect(() => parseReplayDlqArgs(["--execute"])).toThrow(
        "mandatory when executing",
      );
    });

    it("validates --limit bounds (1..1000)", () => {
      expect(() => parseReplayDlqArgs(["--execute", "--limit", "0"])).toThrow(
        "between 1 and 1000",
      );
      expect(() =>
        parseReplayDlqArgs(["--execute", "--limit", "1001"]),
      ).toThrow("between 1 and 1000");
      expect(() =>
        parseReplayDlqArgs(["--execute", "--limit", "invalid"]),
      ).toThrow("between 1 and 1000");

      const valid = parseReplayDlqArgs(["--execute", "--limit", "50"]);
      expect(valid.execute).toBe(true);
      expect(valid.dryRun).toBe(false);
      expect(valid.limit).toBe(50);
    });

    it("validates --batch-size bounds (1..100)", () => {
      expect(() => parseReplayDlqArgs(["--batch-size", "0"])).toThrow(
        "between 1 and 100",
      );
      expect(() => parseReplayDlqArgs(["--batch-size", "101"])).toThrow(
        "between 1 and 100",
      );

      const valid = parseReplayDlqArgs(["--batch-size", "25"]);
      expect(valid.batchSize).toBe(25);
    });

    it("validates --visibility-timeout bounds (30..43200)", () => {
      expect(() => parseReplayDlqArgs(["--visibility-timeout", "29"])).toThrow(
        "between 30 and 43200",
      );
      expect(() =>
        parseReplayDlqArgs(["--visibility-timeout", "43201"]),
      ).toThrow("between 30 and 43200");

      const valid = parseReplayDlqArgs(["--visibility-timeout", "600"]);
      expect(valid.visibilityTimeout).toBe(600);
    });

    it("parses all custom flags correctly", () => {
      const config = parseReplayDlqArgs([
        "--execute",
        "--limit",
        "100",
        "--batch-size",
        "20",
        "--visibility-timeout",
        "400",
        "--account-id",
        "acc-test",
        "--main-queue",
        "q-main",
        "--dlq",
        "q-dlq",
        "--env",
        "production",
      ]);

      expect(config.execute).toBe(true);
      expect(config.limit).toBe(100);
      expect(config.batchSize).toBe(20);
      expect(config.visibilityTimeout).toBe(400);
      expect(config.accountId).toBe("acc-test");
      expect(config.mainQueueId).toBe("q-main");
      expect(config.dlqId).toBe("q-dlq");
      expect(config.environment).toBe("production");
    });
  });

  describe("QueuesHttpClient", () => {
    it("pullMessages parses messages and throws on HTTP or API failure", async () => {
      const mockFetchSuccess = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              messages: [
                {
                  id: "msg-1",
                  lease_id: "lease-1",
                  body: { runId: "r1" },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

      const client = new QueuesHttpClient(mockFetchSuccess);
      const messages = await client.pullMessages(
        "acc-1",
        "dlq-1",
        "tok-1",
        10,
        300,
      );
      expect(messages.length).toBe(1);
      expect(messages[0]?.id).toBe("msg-1");

      // HTTP Error
      const mockFetchFail = vi
        .fn()
        .mockResolvedValue(new Response("Unauthorized", { status: 401 }));
      const clientFail = new QueuesHttpClient(mockFetchFail);
      await expect(
        clientFail.pullMessages("acc-1", "dlq-1", "tok-1", 10, 300),
      ).rejects.toThrow("HTTP status 401");

      // API Error
      const mockFetchApiFail = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "internal error" }],
          }),
          { status: 200 },
        ),
      );
      const clientApiFail = new QueuesHttpClient(mockFetchApiFail);
      await expect(
        clientApiFail.pullMessages("acc-1", "dlq-1", "tok-1", 10, 300),
      ).rejects.toThrow("unsuccessful response");
    });

    it("sendMessage sends message and returns status", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            result: { id: "new-msg-1" },
          }),
          { status: 200 },
        ),
      );
      const client = new QueuesHttpClient(mockFetch);
      const res = await client.sendMessage("acc-1", "q-main", "tok-1", {
        runId: "r1",
      });
      expect(res.success).toBe(true);
      expect(res.id).toBe("new-msg-1");

      // Failure
      const mockFail = vi
        .fn()
        .mockResolvedValue(new Response("Error", { status: 500 }));
      const clientFail = new QueuesHttpClient(mockFail);
      const resFail = await clientFail.sendMessage(
        "acc-1",
        "q-main",
        "tok-1",
        {},
      );
      expect(resFail.success).toBe(false);
    });

    it("ackMessages acknowledges messages or handles errors", async () => {
      const client = new QueuesHttpClient();
      // Empty array returns success immediately
      const emptyRes = await client.ackMessages("acc-1", "dlq-1", "tok-1", []);
      expect(emptyRes.success).toBe(true);
      expect(emptyRes.ackedCount).toBe(0);

      const mockFetchSuccess = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
          }),
          { status: 200 },
        ),
      );
      const clientAck = new QueuesHttpClient(mockFetchSuccess);
      const ackRes = await clientAck.ackMessages("acc-1", "dlq-1", "tok-1", [
        "l1",
        "l2",
      ]);
      expect(ackRes.success).toBe(true);
      expect(ackRes.ackedCount).toBe(2);

      const mockFetchFail = vi
        .fn()
        .mockResolvedValue(new Response("Lease expired", { status: 400 }));
      const clientAckFail = new QueuesHttpClient(mockFetchFail);
      const failRes = await clientAckFail.ackMessages(
        "acc-1",
        "dlq-1",
        "tok-1",
        ["l1"],
      );
      expect(failRes.success).toBe(false);
      expect(failRes.ackedCount).toBe(0);
    });
  });

  describe("replayDlq execution logic", () => {
    it("throws when credentials are missing", async () => {
      const client = new QueuesHttpClient();
      await expect(
        replayDlq(
          {
            execute: false,
            dryRun: true,
            batchSize: 10,
            visibilityTimeout: 300,
          },
          client,
          {},
        ),
      ).rejects.toThrow("Missing CF_ACCOUNT_ID");

      await expect(
        replayDlq(
          {
            execute: false,
            dryRun: true,
            batchSize: 10,
            visibilityTimeout: 300,
          },
          client,
          { CF_ACCOUNT_ID: "acc-1" },
        ),
      ).rejects.toThrow("Missing CF_QUEUES_REPLAY_TOKEN");
    });

    it("runs in dry-run mode without sending or acking", async () => {
      const sendMessageSpy = vi.fn();
      const ackMessagesSpy = vi.fn();
      const mockClient = {
        pullMessages: vi.fn().mockResolvedValue([
          { id: "m1", lease_id: "l1", body: {} },
          { id: "m2", lease_id: "l2", body: {} },
        ]),
        sendMessage: sendMessageSpy,
        ackMessages: ackMessagesSpy,
      } as unknown as QueuesHttpClient;

      const summary = await replayDlq(
        {
          execute: false,
          dryRun: true,
          batchSize: 10,
          visibilityTimeout: 300,
        },
        mockClient,
        {
          CF_ACCOUNT_ID: "acc-1",
          CF_QUEUES_REPLAY_TOKEN: "tok-1",
        },
      );

      expect(summary.pulled).toBe(2);
      expect(summary.requeued).toBe(0);
      expect(summary.acked).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.dryRun).toBe(true);
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect(ackMessagesSpy).not.toHaveBeenCalled();
    });

    it("executes replay, requeuing and acking on DLQ", async () => {
      const sendMessageSpy = vi
        .fn()
        .mockResolvedValue({ success: true, id: "new-id" });
      const ackMessagesSpy = vi
        .fn()
        .mockResolvedValue({ success: true, ackedCount: 1 });
      const mockClient = {
        pullMessages: vi
          .fn()
          .mockResolvedValueOnce([
            { id: "m1", lease_id: "l1", body: { run: 1 } },
            { id: "m2", lease_id: "l2", body: { run: 2 } },
          ])
          .mockResolvedValueOnce([]), // 2nd batch empty
        sendMessage: sendMessageSpy,
        ackMessages: ackMessagesSpy,
      } as unknown as QueuesHttpClient;

      const summary = await replayDlq(
        {
          execute: true,
          dryRun: false,
          limit: 10,
          batchSize: 5,
          visibilityTimeout: 300,
        },
        mockClient,
        {
          CF_ACCOUNT_ID: "acc-1",
          CF_QUEUES_REPLAY_TOKEN: "tok-1",
        },
      );

      expect(summary.pulled).toBe(2);
      expect(summary.requeued).toBe(2);
      expect(summary.acked).toBe(2);
      expect(summary.failed).toBe(0);
      expect(summary.dryRun).toBe(false);
      expect(sendMessageSpy).toHaveBeenCalledTimes(2);
      expect(ackMessagesSpy).toHaveBeenCalledTimes(2);
    });

    it("handles partial failure during send or ack", async () => {
      const mockClient = {
        pullMessages: vi.fn().mockResolvedValue([
          { id: "m1", lease_id: "l1", body: {} }, // Send will fail
          { id: "m2", lease_id: "l2", body: {} }, // Ack will fail
        ]),
        sendMessage: vi
          .fn()
          .mockResolvedValueOnce({ success: false }) // m1 fails send
          .mockResolvedValueOnce({ success: true }), // m2 succeeds send
        ackMessages: vi
          .fn()
          .mockResolvedValueOnce({ success: false, ackedCount: 0 }), // m2 fails ack
      } as unknown as QueuesHttpClient;

      const summary = await replayDlq(
        {
          execute: true,
          dryRun: false,
          limit: 2,
          batchSize: 2,
          visibilityTimeout: 300,
        },
        mockClient,
        {
          CF_ACCOUNT_ID: "acc-1",
          CF_QUEUES_REPLAY_TOKEN: "tok-1",
        },
      );

      expect(summary.pulled).toBe(2);
      expect(summary.requeued).toBe(1); // only m2 requeued
      expect(summary.acked).toBe(0);
      expect(summary.failed).toBe(2); // m1 failed send, m2 failed ack
    });
  });

  describe("runCli", () => {
    it("returns 0 on successful dry-run or execute", async () => {
      const mockClient = {
        pullMessages: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn(),
        ackMessages: vi.fn(),
      } as unknown as QueuesHttpClient;

      const code = await runCli(
        ["--dry-run"],
        { CF_ACCOUNT_ID: "acc-1", CF_QUEUES_REPLAY_TOKEN: "tok-1" },
        mockClient,
      );
      expect(code).toBe(0);
    });

    it("returns 1 when failures occur or exceptions are thrown", async () => {
      const mockClientFail = {
        pullMessages: vi
          .fn()
          .mockResolvedValue([{ id: "m1", lease_id: "l1", body: {} }]),
        sendMessage: vi.fn().mockResolvedValue({ success: false }),
        ackMessages: vi.fn(),
      } as unknown as QueuesHttpClient;

      const codeFail = await runCli(
        ["--execute", "--limit", "1"],
        { CF_ACCOUNT_ID: "acc-1", CF_QUEUES_REPLAY_TOKEN: "tok-1" },
        mockClientFail,
      );
      expect(codeFail).toBe(1);

      // Exception thrown (e.g. invalid args)
      const codeError = await runCli(["--execute"]);
      expect(codeError).toBe(1);
    });
  });
});
