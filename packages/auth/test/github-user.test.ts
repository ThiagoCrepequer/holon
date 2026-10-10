import type { AdmittedUser } from "@holon/contracts/dashboard";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it } from "vitest";

import { credentialKeyConfig } from "../src/credential-key.server.js";
import { createGitHubUserService } from "../src/github-user.server.js";
const bindings = env as { AUTH_DB: D1Database; AUTH_MIGRATIONS: D1Migration[] };
const db = bindings.AUTH_DB;
const actor: AdmittedUser = {
  id: "github_user",
  name: "Synthetic",
  sessionId: "github_session",
  githubAccountId: "101",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const secret = "synthetic-credential-key-with-32-characters";
const installation = {
  id: 55,
  app_id: 77,
  account: { id: 101, type: "User", login: "synthetic" },
  suspended_at: null,
};
afterEach(async () => reset());
async function setup(expired = false, extra: Record<string, unknown> = {}) {
  await applyD1Migrations(db, bindings.AUTH_MIGRATIONS);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('github_user','Synthetic','synthetic@example.invalid',1,?,?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO account(id,userId,providerId,accountId,accessToken,refreshToken,accessTokenExpiresAt,refreshTokenExpiresAt,createdAt,updatedAt) VALUES('github_account','github_user','github','101',?,?,?,?,?,?)",
      )
      .bind(
        await symmetricEncrypt({ key: secret, data: "synthetic-access" }),
        await symmetricEncrypt({ key: secret, data: "synthetic-refresh" }),
        expired ? now - 1000 : now + 3600000,
        now + 7200000,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO session(id,userId,token,createdAt,updatedAt,expiresAt) VALUES('github_session','github_user','synthetic-session',?,?,?)",
      )
      .bind(now, now, now + 3600000),
  ]);
  for (const [field, value] of Object.entries(extra))
    await db.prepare(`UPDATE account SET ${field}=?`).bind(value).run();
}
function service(transport: typeof fetch) {
  return createGitHubUserService({
    database: db,
    clientId: "synthetic-client",
    clientSecret: "synthetic-secret",
    appId: 77,
    cryptoKey: secret,
    fetch: transport,
  });
}
function provider(overrides: Record<string, unknown> = {}): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    if (url.hostname === "github.com") {
      expect(init?.method).toBe("POST");
      const body = init?.body;
      if (!(body instanceof URLSearchParams)) throw new Error("bad fixture");
      expect(body.get("grant_type")).toBe("refresh_token");
      return Response.json(
        overrides.refresh ?? {
          access_token: "renewed-access",
          refresh_token: "renewed-refresh",
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
        },
      );
    }
    expect(new Headers(init?.headers).get("Authorization")).toMatch(
      /^Bearer (synthetic-access|renewed-access)$/,
    );
    expect(new Headers(init?.headers).get("X-GitHub-Api-Version")).toBe(
      "2026-03-10",
    );
    if (url.pathname === "/user")
      return Response.json(overrides.user ?? { id: 101 });
    if (url.pathname === "/user/emails")
      return Response.json(
        overrides.emails ?? [
          { email: "target@example.invalid", verified: true, primary: false },
          {
            email: "unverified@example.invalid",
            verified: false,
            primary: true,
          },
        ],
      );
    if (url.pathname === "/user/installations")
      return Response.json(
        overrides.installations ?? {
          total_count: 1,
          installations: [installation],
        },
      );
    if (url.pathname.startsWith("/user/memberships/orgs/"))
      return Response.json(
        overrides.membership ?? {
          state: "active",
          role: "admin",
          organization: { id: 999 },
        },
      );
    if (url.pathname === "/user/memberships/orgs")
      return Response.json(overrides.memberships ?? []);
    if (url.pathname === "/user/installations/55/repositories")
      return Response.json(
        overrides.repositories ?? {
          total_count: 2,
          repositories: [
            { id: 901, full_name: "synthetic/repository-901" },
            { id: 902, full_name: "synthetic/repository-902" },
          ],
        },
      );
    throw new Error("unexpected fixture request");
  };
}
it("reads stable subject, verified non-primary emails and complete human grants without disclosing credentials", async () => {
  await setup();
  const github = service(provider());
  expect(await github.status(actor)).toEqual({ status: "connected" });
  expect(await github.recipient(actor)).toEqual({
    accountId: "github_account",
    generation: 1,
    verifiedEmails: ["target@example.invalid"],
  });
  expect(await github.verifyInstallation(actor, 55)).toEqual({
    accountId: "github_account",
    credentialGeneration: 1,
    installationId: 55,
    accountOwnerId: 101,
  });
  expect(await github.repositories(actor, 55)).toEqual({
    accountId: "github_account",
    generation: 1,
    repositories: [
      { id: 901, fullName: "synthetic/repository-901" },
      { id: 902, fullName: "synthetic/repository-902" },
    ],
  });
  expect(JSON.stringify(await github.identity(actor))).not.toContain("access");
});
it.each([
  "wrong_app",
  "suspended",
  "missing",
  "wrong_owner",
  "wrong_subject",
  "org_member",
  "org_pending",
] as const)("denies installation proof %s", async (kind) => {
  await setup();
  const org = kind === "org_member" || kind === "org_pending";
  const i = {
    ...installation,
    app_id: kind === "wrong_app" ? 999 : 77,
    suspended_at: kind === "suspended" ? "2026-10-08T00:00:00Z" : null,
    account: org
      ? { id: 999, type: "Organization", login: "synthetic_org" }
      : { ...installation.account, id: kind === "wrong_owner" ? 102 : 101 },
  };
  const github = service(
    provider({
      installations: {
        total_count: kind === "missing" ? 0 : 1,
        installations: kind === "missing" ? [] : [i],
      },
      user: { id: kind === "wrong_subject" ? 102 : 101 },
      memberships: [
        {
          state: kind === "org_pending" ? "pending" : "active",
          role: kind === "org_member" ? "member" : "admin",
          organization: { id: 999 },
        },
      ],
    }),
  );
  await expect(github.verifyInstallation(actor, 55)).rejects.toMatchObject({
    code: kind === "wrong_subject" ? "reconnect_required" : "denied",
  });
});
it("paginates installations, organization ownership and repos past the first page", async () => {
  await setup();
  const base = provider();
  let calls = 0;
  const github = service(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const page = url.searchParams.get("page");
    if (url.pathname === "/user/installations") {
      calls++;
      return Response.json({
        total_count: 101,
        installations:
          page === "1"
            ? Array.from({ length: 100 }, (_, i) => ({
                ...installation,
                id: 1000 + i,
              }))
            : [
                {
                  ...installation,
                  account: {
                    id: 999,
                    type: "Organization",
                    login: "synthetic_org",
                  },
                },
              ],
      });
    }
    if (url.pathname === "/user/memberships/orgs")
      return Response.json(
        page === "1"
          ? Array.from({ length: 100 }, (_, i) => ({
              state: "active",
              role: "member",
              organization: { id: 2000 + i },
            }))
          : [{ state: "active", role: "admin", organization: { id: 999 } }],
      );
    if (url.pathname === "/user/installations/55/repositories")
      return Response.json({
        total_count: 101,
        repositories:
          page === "1"
            ? Array.from({ length: 100 }, (_, i) => ({
                id: 3000 + i,
                full_name: `synthetic/repository-${3000 + i}`,
              }))
            : [{ id: 4001, full_name: "synthetic/repository-4001" }],
      });
    return base(input, init);
  });
  expect((await github.verifyInstallation(actor, 55)).accountOwnerId).toBe(999);
  expect((await github.repositories(actor, 55)).repositories).toHaveLength(101);
  expect(calls).toBe(6);
});
it.each([
  "truncated_installations",
  "duplicate_installations",
  "truncated_repositories",
  "duplicate_repositories",
  "invalid_email",
  "invalid_json",
] as const)("incomplete provider %s fails closed", async (kind) => {
  await setup();
  const base = provider({
    installations:
      kind === "truncated_installations"
        ? { total_count: 2, installations: [installation] }
        : kind === "duplicate_installations"
          ? { total_count: 2, installations: [installation, installation] }
          : undefined,
    repositories:
      kind === "truncated_repositories"
        ? {
            total_count: 3,
            repositories: [{ id: 901, full_name: "synthetic/repository-901" }],
          }
        : kind === "duplicate_repositories"
          ? {
              total_count: 2,
              repositories: [
                { id: 901, full_name: "synthetic/repository-901" },
                { id: 901, full_name: "synthetic/repository-901" },
              ],
            }
          : undefined,
    emails:
      kind === "invalid_email"
        ? [{ email: "bad", verified: true, primary: false }]
        : undefined,
  });
  const github = service(
    kind === "invalid_json" ? async () => new Response("{") : base,
  );
  await expect(
    kind === "invalid_email"
      ? github.recipient(actor)
      : github.repositories(actor, 55),
  ).rejects.toMatchObject({ code: "unavailable" });
});
it.each([401, 403, 429, 500] as const)(
  "HTTP %s is an explicit safe error",
  async (status) => {
    await setup();
    await expect(
      service(async () => new Response(null, { status })).recipient(actor),
    ).rejects.toMatchObject({
      code: status === 401 ? "reconnect_required" : "unavailable",
    });
    if (status === 401)
      expect(await service(provider()).status(actor)).toEqual({
        status: "reconnect_required",
      });
  },
);
it("network failure never becomes an empty grant set", async () => {
  await setup();
  await expect(
    service(async () => {
      throw new Error("synthetic network details");
    }).repositories(actor, 55),
  ).rejects.toMatchObject({ code: "unavailable" });
});
it("refresh writes an encrypted pair before success", async () => {
  await setup(true);
  const github = service(provider());
  expect(await github.identity(actor)).toEqual({
    accountId: "github_account",
    generation: 2,
  });
  const row = await db
    .prepare("SELECT accessToken,refreshToken FROM account")
    .first<{ accessToken: string; refreshToken: string }>();
  expect(row?.accessToken).not.toContain("renewed-access");
  expect(await symmetricDecrypt({ key: secret, data: row!.accessToken })).toBe(
    "renewed-access",
  );
  expect(await symmetricDecrypt({ key: secret, data: row!.refreshToken })).toBe(
    "renewed-refresh",
  );
});
it("independent workers allow one remote refresh and the loser rereads current state", async () => {
  await setup(true);
  let started!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  let finish!: () => void;
  const pending = new Promise<void>((r) => {
    finish = r;
  });
  let effects = 0;
  const base = provider();
  const transport: typeof fetch = async (input, init) => {
    if (
      (input instanceof Request ? input.url : input.toString()).startsWith(
        "https://github.com/",
      )
    ) {
      effects++;
      started();
      await pending;
    }
    return base(input, init);
  };
  const winner = service(transport).identity(actor);
  await entered;
  await expect(service(transport).identity(actor)).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(await service(transport).status(actor)).toEqual({
    status: "refreshing",
  });
  finish();
  await winner;
  expect(await service(transport).identity(actor)).toEqual({
    accountId: "github_account",
    generation: 2,
  });
  expect(effects).toBe(1);
});
it.each([
  "lost_response",
  "invalid_pair",
  "http_failure",
  "write_failure",
] as const)(
  "refresh %s blocks credentials without a blind retry",
  async (kind) => {
    await setup(true);
    if (kind === "write_failure")
      await db.exec(
        "CREATE TRIGGER fail_refresh BEFORE UPDATE OF accessToken ON account BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;",
      );
    let effects = 0;
    const github = service(async (input, init) => {
      effects++;
      if (kind === "lost_response") throw new Error("lost");
      if (kind === "http_failure") return new Response(null, { status: 500 });
      return provider({
        refresh:
          kind === "invalid_pair" ? { access_token: "incomplete" } : undefined,
      })(input, init);
    });
    await expect(github.identity(actor)).rejects.toMatchObject({
      code: "reconnect_required",
    });
    await expect(github.identity(actor)).rejects.toMatchObject({
      code: "reconnect_required",
    });
    expect(effects).toBe(1);
  },
);
it.each([
  "no_access",
  "no_refresh",
  "expired_refresh",
  "bad_cipher",
  "expired_claim",
  "revoked_session",
] as const)("credential %s cannot authorize private reads", async (kind) => {
  await setup(kind === "no_refresh" || kind === "expired_refresh");
  if (kind === "no_access")
    await db.prepare("UPDATE account SET accessToken=NULL").run();
  if (kind === "no_refresh")
    await db.prepare("UPDATE account SET refreshToken=NULL").run();
  if (kind === "expired_refresh")
    await db.prepare("UPDATE account SET refreshTokenExpiresAt=0").run();
  if (kind === "bad_cipher")
    await db.prepare("UPDATE account SET accessToken='invalid-cipher'").run();
  if (kind === "expired_claim")
    await db
      .prepare(
        "UPDATE github_credential_state SET state='refreshing',claim_until=0,claim_id='expired'",
      )
      .run();
  if (kind === "revoked_session") await db.prepare("DELETE FROM session").run();
  await expect(service(provider()).identity(actor)).rejects.toMatchObject({
    code: kind === "revoked_session" ? "denied" : "reconnect_required",
  });
});
it("versioned public library envelope decrypts legacy key and keeps retained keys for rotation", async () => {
  const ring = [
    { version: 2, value: "synthetic-new-secret-with-32-characters" },
    { version: 1, value: secret },
  ];
  const config = credentialKeyConfig(secret, ring);
  const ciphertext = await symmetricEncrypt({
    key: config.cryptoKey,
    data: "synthetic",
  });
  expect(ciphertext.startsWith("$ba$")).toBe(true);
  expect(
    await symmetricDecrypt({ key: config.cryptoKey, data: ciphertext }),
  ).toBe("synthetic");
  expect(
    await symmetricDecrypt({
      key: config.cryptoKey,
      data: await symmetricEncrypt({ key: secret, data: "legacy" }),
    }),
  ).toBe("legacy");
  expect(() => credentialKeyConfig(secret, [ring[0], ring[0]])).toThrow();
  expect(() => credentialKeyConfig(secret, [])).toThrow();
  expect(credentialKeyConfig(secret).cryptoKey).toBe(secret);
});

it("rejects a repository grant response belonging to another stable GitHub subject", async () => {
  await setup();
  await expect(
    service(provider({ user: { id: 202 } })).repositories(actor, 55),
  ).rejects.toMatchObject({ code: "reconnect_required" });
});

it("reports reconnection before an operation when both token lifetimes are exhausted", async () => {
  await setup(true, { refreshTokenExpiresAt: Date.now() - 1000 });
  const transport = provider();
  expect(await service(transport).status(actor)).toEqual({
    status: "reconnect_required",
  });
});

it.each(["demoted", "pending", "different_org"] as const)(
  "organization ownership is revalidated after pagination: %s",
  async (kind) => {
    await setup();
    const organization = {
      ...installation,
      account: { id: 999, type: "Organization", login: "synthetic_org" },
    };
    const base = provider({
      installations: { total_count: 1, installations: [organization] },
      memberships: [
        { state: "active", role: "admin", organization: { id: 999 } },
      ],
    });
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.pathname === "/user/memberships/orgs/synthetic_org")
        return Response.json({
          state: kind === "pending" ? "pending" : "active",
          role: kind === "demoted" ? "member" : "admin",
          organization: { id: kind === "different_org" ? 998 : 999 },
        });
      return base(input, init);
    };
    await expect(
      service(transport).verifyInstallation(actor, 55),
    ).rejects.toMatchObject({ code: "denied" });
  },
);
