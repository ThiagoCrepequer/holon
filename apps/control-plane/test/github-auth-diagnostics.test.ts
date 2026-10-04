import { createPrivateKey } from "node:crypto";

import { createInstallationSession } from "@holon/github";
import { expect, it, vi } from "vitest";

import { executeGitHubOperation } from "../src/github/github-operations.js";

it("identifies the real Workers PKCS1 signing rejection through the Workflow adapter", async () => {
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
  const pem = createPrivateKey({
    key: Buffer.from(der),
    format: "der",
    type: "pkcs8",
  })
    .export({ format: "pem", type: "pkcs1" })
    .toString();
  const write = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const error = await executeGitHubOperation(() =>
    createInstallationSession(
      { appId: 123, appSlug: "holon", privateKey: pem },
      1,
      42,
    ),
  ).catch((failure) => failure);
  expect(error).toMatchObject({
    phase: "jwt_signing",
    reason: "github_key_pkcs1_unsupported",
  });
  expect(JSON.stringify(write.mock.calls)).not.toContain(pem);
  expect(JSON.stringify(error)).not.toContain(pem);
});

it("signs PKCS8 in Workers and preserves an HTTP rejection through the Workflow", async () => {
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
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----`;
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, options) => {
      const authorization = new Headers(options?.headers).get("authorization")!;
      const jwt = authorization.slice("bearer ".length);
      const [header, payload, signature] = jwt.split(".");
      expect(
        await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          keys.publicKey,
          Buffer.from(signature!, "base64url"),
          new TextEncoder().encode(`${header}.${payload}`),
        ),
      ).toBe(true);
      return Response.json(
        { message: "PRIVATE server body" },
        {
          status: 401,
          headers: { "x-github-request-id": "ABCD:1234:5678:90AB" },
        },
      );
    });
  const write = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const error = await executeGitHubOperation(() =>
    createInstallationSession(
      { appId: 123, appSlug: "holon", privateKey: pem },
      2,
      42,
    ),
  ).catch((failure) => failure);
  expect(error).toMatchObject({
    phase: "installation_token_request",
    reason: "github_auth_rejected",
    statusCode: 401,
    githubRequestId: "ABCD:1234:5678:90AB",
  });
  expect(error.message).toContain(
    ":installation_token_request:github_auth_rejected",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(write.mock.calls)).not.toContain("PRIVATE server body");
  expect(JSON.stringify(error)).not.toContain(pem);
});
