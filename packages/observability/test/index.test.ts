import { describe, expect, it, vi } from "vitest";

import {
  consoleErrorReporter,
  safeErrorDetails,
  withErrorReporting,
  withErrorReportingSync,
} from "../src/index.js";

describe("safe error diagnostics", () => {
  it("keeps typed codes, status and causes but never exception messages or stacks", () => {
    const cause = Object.assign(new Error("private key material"), {
      code: "invalid_response",
      statusCode: 422,
      retryable: false,
    });
    const error = new Error("private diff contents", { cause });
    const details = safeErrorDetails(error);
    expect(details).toEqual({
      errorName: "Error",
      causeName: "Error",
      causeCode: "invalid_response",
      causeStatusCode: 422,
      causeRetryable: false,
    });
    expect(JSON.stringify(details)).not.toMatch(/private|stack|message/u);
  });

  it("reports only allowlisted context fields and structured error severity", () => {
    const write = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    consoleErrorReporter.report(
      "queue.item_failed",
      new TypeError("bearer token"),
      {
        component: "control-plane",
        operation: "queue.dispatch",
        runId: "github:42:pr:7:head:abc",
        token: "should never appear",
      } as never,
    );
    const entry = write.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      severity: "error",
      event: "queue.item_failed",
      component: "control-plane",
      operation: "queue.dispatch",
      runId: "github:42:pr:7:head:abc",
      errorName: "TypeError",
    });
    expect(JSON.stringify(entry)).not.toContain("bearer token");
    expect(JSON.stringify(entry)).not.toContain("should never appear");
    write.mockRestore();
  });

  it("rethrows the original error even if logging itself fails", async () => {
    const failure = new Error("private");
    await expect(
      withErrorReporting(
        "workflow.step_failed",
        {
          report: () => {
            throw new Error("logger failed");
          },
        },
        { operation: "workflow.step" },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
  });

  it("keeps operational status and phase while discarding untrusted fields", () => {
    expect(
      safeErrorDetails({
        name: "GitHubRequestError",
        code: "rate_limited",
        status: 429,
        retryable: true,
        phase: "installation_auth",
        originName: "RequestError",
        message: "private response body",
      }),
    ).toEqual({
      errorName: "GitHubRequestError",
      errorCode: "rate_limited",
      statusCode: 429,
      retryable: true,
      errorPhase: "installation_auth",
      causeName: "RequestError",
    });
    expect(safeErrorDetails(null)).toEqual({ errorName: "UnknownError" });
    expect(
      safeErrorDetails({
        name: "private key",
        code: "private key",
        status: 999,
        phase: "private key",
        retryable: "yes",
        cause: null,
      }),
    ).toEqual({
      errorName: "UnknownError",
      causeName: "UnknownError",
    });
    expect(
      safeErrorDetails(new Error("HOLON_GITHUB_UPSTREAM:network")),
    ).toEqual({
      errorName: "Error",
      errorCode: "HOLON_GITHUB_UPSTREAM:network",
    });
  });

  it("drops invalid IDs and numbers from the structured log", () => {
    const write = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    consoleErrorReporter.report(
      "unsafe event",
      { name: "TypeError", statusCode: 503 },
      {
        component: "admin",
        messageId: "private id with spaces",
        repositoryId: -1,
        attempt: 2,
        batchSize: Number.NaN,
        token: "secret",
      } as never,
    );
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      event: "diagnostics.invalid_event",
      component: "admin",
      attempt: 2,
      errorName: "TypeError",
      statusCode: 503,
    });
    expect(JSON.stringify(write.mock.calls[0]?.[0])).not.toMatch(
      /private|secret|repositoryId|batchSize/u,
    );
    write.mockRestore();
  });

  it("preserves synchronous results and failures", () => {
    const report = vi.fn();
    const reporter = { report };
    expect(withErrorReportingSync("sync.failed", reporter, {}, () => 42)).toBe(
      42,
    );
    expect(report).not.toHaveBeenCalled();
    const failure = new Error("private material");
    expect(() =>
      withErrorReportingSync(
        "sync.failed",
        reporter,
        { operation: "rpc" },
        () => {
          throw failure;
        },
      ),
    ).toThrow(failure);
    expect(report).toHaveBeenCalledWith("sync.failed", failure, {
      operation: "rpc",
    });
  });
});
