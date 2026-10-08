import { expect, it } from "vitest";

import { validateGitHubAuthConfig } from "../src/server.js";

it.each(["preview", "production"] as const)(
  "%s cannot homologate a loopback origin",
  (environment) => {
    expect(() =>
      validateGitHubAuthConfig({
        clientId: "synthetic-client-id",
        clientSecret: "synthetic-client-secret",
        appOrigin: "https://localhost",
        environment,
        homologatedOrigins: new Map([[environment, ["https://localhost"]]]),
      }),
    ).toThrow();
  },
);

it("preview cannot homologate a production origin even if both environment lists contain it", () => {
  const appOrigin = "https://production.example.invalid";
  expect(() =>
    validateGitHubAuthConfig({
      clientId: "synthetic-client-id",
      clientSecret: "synthetic-client-secret",
      appOrigin,
      environment: "preview",
      homologatedOrigins: new Map([
        ["preview", [appOrigin]],
        ["production", [appOrigin]],
      ]),
    }),
  ).toThrow();
});
