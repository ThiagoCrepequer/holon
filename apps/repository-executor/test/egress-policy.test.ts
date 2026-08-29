import { describe, expect, it } from "vitest";

import { authenticateGitHubRequest } from "../src/egress-policy.js";

describe("Sandbox GitHub egress policy", () => {
  const parameters = {
    repositoryPath: "/acme/api.git",
    token: "installation-token",
  };

  it.each(["GET", "POST"])(
    "injects the installation credential only for an allowed %s request",
    (method) => {
      const request = authenticateGitHubRequest(
        new Request("https://github.com/acme/api.git/info/refs", { method }),
        parameters,
      );
      expect(request?.headers.get("authorization")).toBe(
        `Basic ${btoa("x-access-token:installation-token")}`,
      );
      expect(request?.redirect).toBe("manual");
    },
  );

  it.each([
    [
      "wrong host",
      "https://evil.example/acme/api.git/info/refs",
      "GET",
      parameters,
    ],
    [
      "wrong repository",
      "https://github.com/acme/other.git/info/refs",
      "GET",
      parameters,
    ],
    [
      "prefix confusion",
      "https://github.com/acme/api.git-evil/info/refs",
      "GET",
      parameters,
    ],
    [
      "insecure protocol",
      "http://github.com/acme/api.git/info/refs",
      "GET",
      parameters,
    ],
    [
      "unsafe method",
      "https://github.com/acme/api.git/info/refs",
      "DELETE",
      parameters,
    ],
    [
      "missing token",
      "https://github.com/acme/api.git/info/refs",
      "GET",
      { repositoryPath: "/acme/api.git" },
    ],
    [
      "invalid path",
      "https://github.com/acme/api.git/info/refs",
      "GET",
      { repositoryPath: "/acme/*", token: "x" },
    ],
    [
      "dot-segment owner",
      "https://github.com/acme/api.git/info/refs",
      "GET",
      { repositoryPath: "/../api.git", token: "x" },
    ],
  ])("rejects %s", (_name, url, method, rawParameters) => {
    expect(
      authenticateGitHubRequest(new Request(url, { method }), rawParameters),
    ).toBeUndefined();
  });
});
