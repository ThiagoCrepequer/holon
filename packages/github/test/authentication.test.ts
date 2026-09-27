import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiagnosticAppAuth } from "../src/authentication.js";

const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const der = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
const credentials = {
  appId: 123,
  appSlug: "holon",
  privateKey: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(der)))}\n-----END PRIVATE KEY-----`,
};
afterEach(() => vi.unstubAllGlobals());

describe("real Octokit authentication boundaries", () => {
  it("signs and exchanges a scoped token without changing the SDK contract", async () => {
    const fetcher = vi.fn(async (_url, options) => {
      expect(JSON.parse(options.body)).toEqual({ repository_ids: [42] });
      expect(options.headers.authorization).toMatch(
        /^bearer [\w-]+\.[\w-]+\.[\w-]+$/u,
      );
      return Response.json({
        token: "synthetic-token",
        expires_at: "2099-01-01T00:00:00Z",
        permissions: {},
        repository_selection: "selected",
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const auth = await createDiagnosticAppAuth(credentials);
    expect(
      await auth({
        type: "installation",
        installationId: 1,
        repositoryIds: [42],
      }),
    ).toMatchObject({ token: "synthetic-token" });
    await auth({
      type: "installation",
      installationId: 1,
      repositoryIds: [42],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a signing failure before any HTTP request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const auth = await createDiagnosticAppAuth({
      ...credentials,
      privateKey:
        "-----BEGIN PRIVATE KEY-----\nbroken\n-----END PRIVATE KEY-----",
    });
    await expect(
      auth({ type: "installation", installationId: 2 }),
    ).rejects.toMatchObject({ phase: "jwt_signing", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 503])(
    "retains status and request ID for HTTP %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { message: "SECRET response" },
            {
              status,
              headers: { "x-github-request-id": "ABCD:1234:5678:90AB" },
            },
          ),
        ),
      );
      const auth = await createDiagnosticAppAuth(credentials);
      const error = await auth({
        type: "installation",
        installationId: 3,
      }).catch((failure) => failure);
      expect(error).toMatchObject({
        phase: "installation_token_request",
        statusCode: status,
        githubRequestId: "ABCD:1234:5678:90AB",
        retryable: status >= 429,
      });
      expect(JSON.stringify(error)).not.toContain("SECRET");
    },
  );

  it("identifies successful HTTP responses with malformed token data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ token: "SECRET", expires_at: "invalid" }),
      ),
    );
    const auth = await createDiagnosticAppAuth(credentials);
    await expect(
      auth({ type: "installation", installationId: 4 }),
    ).rejects.toMatchObject({
      phase: "installation_token_response",
      reason: "github_response_invalid",
    });
  });

  it("labels auth initialization failures", async () => {
    await expect(
      createDiagnosticAppAuth({ ...credentials, appId: 0 }),
    ).rejects.toMatchObject({
      phase: "auth_configuration",
      reason: "github_configuration_invalid",
    });
  });
});
