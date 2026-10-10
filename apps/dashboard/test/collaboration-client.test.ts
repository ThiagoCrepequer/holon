import { afterEach, expect, it, vi } from "vitest";

import {
  collaborationRequest,
  connectionOAuth,
  reconnectGitHub,
} from "../app/features/collaboration/collaboration-client.js";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  [403, "denied"],
  [401, "reconnect"],
  [429, "rate_limited"],
  [500, "unavailable"],
] as const)("HTTP %i reports %s safely", async (status, expected) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: { code: "safe" } }, { status })),
  );
  expect(
    await collaborationRequest("/api/workspaces", new AbortController().signal),
  ).toEqual({ status: expected });
});
it("commands retain unknown outcome and reads distinguish unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network");
    }),
  );
  const signal = new AbortController().signal;
  expect(await collaborationRequest("/api/workspaces", signal)).toEqual({
    status: "unavailable",
  });
  expect(
    await collaborationRequest("/api/workspaces/team", signal, {
      csrf: "synthetic",
      body: {},
    }),
  ).toEqual({ status: "unconfirmed" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: { code: "command_unknown" } }, { status: 503 }),
    ),
  );
  expect(
    await collaborationRequest("/api/workspaces/team", signal, {
      csrf: "synthetic",
      body: {},
    }),
  ).toEqual({ status: "unconfirmed" });
});
it("only documented GitHub authorization redirects are used after scoped reauth", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ reauthIntentId: "reauth_synthetic" }),
    )
    .mockResolvedValueOnce(
      Response.json({
        url: "https://github.com/login/oauth/authorize?state=synthetic",
      }),
    );
  vi.stubGlobal("fetch", fetch);
  expect(
    await connectionOAuth(
      "workspace",
      77,
      "link",
      "csrf",
      new AbortController().signal,
    ),
  ).toBe("https://github.com/login/oauth/authorize?state=synthetic");
  expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toMatchObject({
    reauthIntentId: "reauth_synthetic",
    callbackURL:
      "/account?workspace=workspace&installation=77&connectionAction=link&reauth=reauth_synthetic",
  });
});
it.each([null, {}, { reauthIntentId: 42 }])(
  "unconfirmed proof %j never initiates OAuth",
  async (data) => {
    const fetch = vi.fn(async () => Response.json(data));
    vi.stubGlobal("fetch", fetch);
    expect(
      await connectionOAuth(
        "workspace",
        77,
        "link",
        "csrf",
        new AbortController().signal,
      ),
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it.each([
  "https://evil.example.invalid/path",
  "https://github.com/other",
  "invalid",
])("denies redirect %s", async (url) => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ reauthIntentId: "proof" }))
    .mockResolvedValueOnce(Response.json({ url }));
  vi.stubGlobal("fetch", fetch);
  expect(
    await connectionOAuth(
      "workspace",
      77,
      "unlink",
      "csrf",
      new AbortController().signal,
    ),
  ).toBeNull();
});
it.each([null, {}, { url: 1 }])(
  "invalid OAuth response %j is safe",
  async (data) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ reauthIntentId: "proof" }))
      .mockResolvedValueOnce(Response.json(data));
    vi.stubGlobal("fetch", fetch);
    expect(
      await connectionOAuth(
        "workspace",
        77,
        "unlink",
        "csrf",
        new AbortController().signal,
      ),
    ).toBeNull();
  },
);
it("OAuth failure/reconnect preserves the current page and uses the same provider", async () => {
  vi.stubGlobal("window", {
    location: {
      href: "https://dashboard.example.invalid/?workspace=synthetic",
    },
  });
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 500 }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await reconnectGitHub(new AbortController().signal)).toBeNull();
  expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toMatchObject({
    provider: "github",
    callbackURL: "https://dashboard.example.invalid/?workspace=synthetic",
  });
});
