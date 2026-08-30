import { describe, expect, it } from "vitest";

import {
  authenticateGitHubRequest,
  createGitHubEgressUrl,
} from "../src/egress-policy.js";

describe("Sandbox GitHub egress policy", () => {
  const parameters = {
    repositoryPath: "/acme/api.git",
    token: "installation-token",
  };

  it.each(["GET", "POST"])(
    "injects the installation credential only for an allowed %s request",
    (method) => {
      const request = authenticateGitHubRequest(
        new Request("http://github.holon.internal/acme/api.git/info/refs", {
          headers: { authorization: "Bearer attacker-controlled" },
          method,
        }),
        parameters,
      );
      expect(request?.url).toBe("https://github.com/acme/api.git/info/refs");
      expect(request?.headers.get("authorization")).toBe(
        `Basic ${btoa("x-access-token:installation-token")}`,
      );
      expect(request?.redirect).toBe("manual");
    },
  );

  it("maps a validated public clone URL to the internal egress host", () => {
    expect(createGitHubEgressUrl("https://github.com/acme/api.git")).toBe(
      "http://github.holon.internal/acme/api.git",
    );
    expect(() =>
      createGitHubEgressUrl("https://token@github.com/acme/api.git"),
    ).toThrow("credential-free");
  });

  it.each([
    [
      "wrong host",
      "http://evil.example/acme/api.git/info/refs",
      "GET",
      parameters,
    ],
    [
      "wrong repository",
      "http://github.holon.internal/acme/other.git/info/refs",
      "GET",
      parameters,
    ],
    [
      "prefix confusion",
      "http://github.holon.internal/acme/api.git-evil/info/refs",
      "GET",
      parameters,
    ],
    [
      "insecure protocol",
      "https://github.holon.internal/acme/api.git/info/refs",
      "GET",
      parameters,
    ],
    [
      "unsafe method",
      "http://github.holon.internal/acme/api.git/info/refs",
      "DELETE",
      parameters,
    ],
    [
      "missing token",
      "http://github.holon.internal/acme/api.git/info/refs",
      "GET",
      { repositoryPath: "/acme/api.git" },
    ],
    [
      "invalid path",
      "http://github.holon.internal/acme/api.git/info/refs",
      "GET",
      { repositoryPath: "/acme/*", token: "x" },
    ],
    [
      "dot-segment owner",
      "http://github.holon.internal/acme/api.git/info/refs",
      "GET",
      { repositoryPath: "/../api.git", token: "x" },
    ],
  ])("rejects %s", (_name, url, method, rawParameters) => {
    expect(
      authenticateGitHubRequest(new Request(url, { method }), rawParameters),
    ).toBeUndefined();
  });
});
