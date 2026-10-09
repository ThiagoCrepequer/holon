// Test-only HTTPS bridge. The built production Worker handles all application URLs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";

const origin = "https://127.0.0.1:8795";
const clientId = "synthetic-browser-client";
const clientSecret = "synthetic-browser-client-secret";
const codes = new Map();
const tokens = new Map();
let unexpectedEgress = 0;

async function provider(request) {
  const url = new URL(request.url);
  if (
    url.origin === "https://github.com" &&
    url.pathname === "/login/oauth/access_token"
  ) {
    assert.equal(request.method, "POST");
    const input = new URLSearchParams(await request.text());
    assert.equal(input.get("client_id"), clientId);
    assert.equal(input.get("client_secret"), clientSecret);
    assert.equal(
      input.get("redirect_uri"),
      `${origin}/api/auth/callback/github`,
    );
    const code = input.get("code");
    const grant = codes.get(code);
    assert(grant, "Provider received an unregistered code");
    grant.attempts++;
    if (grant.used) return Response.json({ error: "bad_verification_code" });
    assert.equal(
      createHash("sha256")
        .update(input.get("code_verifier") ?? "")
        .digest("base64url"),
      grant.challenge,
    );
    grant.used = true;
    const token = `synthetic-browser-access-${code}`;
    tokens.set(token, grant);
    return Response.json({
      access_token: token,
      refresh_token: `synthetic-browser-refresh-${code}`,
      token_type: "bearer",
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
      scope: "",
    });
  }
  if (url.origin === "https://api.github.com") {
    const token = request.headers
      .get("Authorization")
      ?.replace(/^Bearer /u, "");
    const grant = tokens.get(token);
    assert(grant, "Provider received an unknown synthetic token");
    if (url.pathname === "/user")
      return Response.json({
        id: grant.subject,
        login: `synthetic_${grant.subject}`,
        name: "Synthetic browser user",
        email: null,
        avatar_url: null,
      });
    if (url.pathname === "/user/installations")
      return Response.json({
        total_count: 1,
        installations: [
          {
            id: grant.subject + 100000,
            app_id: 77,
            account: {
              id: grant.subject,
              type: "User",
              login: `synthetic_${grant.subject}`,
            },
            suspended_at: null,
          },
        ],
      });
    if (/^\/user\/installations\/\d+\/repositories$/.test(url.pathname))
      return Response.json({
        total_count: 1,
        repositories: [{ id: grant.subject + 200000 }],
      });
    if (url.pathname === "/user/emails")
      return Response.json([
        {
          email: `browser-${grant.subject}@example.invalid`,
          primary: true,
          verified: true,
          visibility: "private",
        },
        {
          email: `alias-${grant.subject}@example.invalid`,
          primary: false,
          verified: true,
          visibility: "private",
        },
      ]);
  }
  unexpectedEgress++;
  return new Response(null, { status: 403 });
}

const buildDirectory = resolve("build/server");
const config = JSON.parse(
  await readFile(resolve(buildDirectory, "wrangler.json"), "utf8"),
);
const modulePaths = (await readdir(buildDirectory, { recursive: true })).filter(
  (name) => name.endsWith(".js"),
);
const entry = config.main;
const modules = await Promise.all(
  [entry, ...modulePaths.filter((name) => name !== entry)].map(
    async (name) => ({
      type: "ESModule",
      path: resolve(buildDirectory, name),
      contents: await readFile(resolve(buildDirectory, name), "utf8"),
    }),
  ),
);
const source = {
  modules,
  modulesRoot: buildDirectory,
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags,
  outboundService: provider,
};
const authBindings = {
  APP_ORIGIN: origin,
  AUTH_SECRET: "synthetic-browser-auth-secret-at-least-32-chars",
  GITHUB_APP_ID: "77",
  GITHUB_APP_CLIENT_ID: clientId,
  GITHUB_APP_CLIENT_SECRET: clientSecret,
};
const misconfigured = [
  {
    name: "missing-origin",
    bindings: { AUTH_SECRET: authBindings.AUTH_SECRET },
  },
  {
    name: "partial-auth",
    bindings: { APP_ORIGIN: origin, AUTH_SECRET: authBindings.AUTH_SECRET },
  },
  { name: "missing-database", bindings: authBindings },
  {
    name: "invalid-secret",
    bindings: { ...authBindings, AUTH_SECRET: 42 },
    d1Databases: ["IDENTITY_DB"],
  },
];
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        ...source,
        name: "native-browser",
        bindings: { ...config.vars, ...authBindings },
        d1Databases: ["IDENTITY_DB", "PROJECTION_DB"],
        assets: {
          routerConfig: { has_user_worker: true },
          directory: resolve(buildDirectory, config.assets.directory),
          ...(config.assets.binding ? { binding: config.assets.binding } : {}),
        },
      },
      {
        name: "access-event-bridge",
        compatibilityDate: config.compatibility_date,
        modules: true,
        serviceBindings: {
          ACCESS: { name: "native-browser", entrypoint: "GitHubAccessEvents" },
        },
        script: `export default {async fetch(request,env){await env.ACCESS.applyEvent(await request.json());return Response.json({ok:true});}}`,
      },
      ...misconfigured.map((worker) => ({ ...source, ...worker })),
    ],
  }),
);

for (const [binding, authority] of [
  ["IDENTITY_DB", "identity"],
  ["PROJECTION_DB", "projection"],
]) {
  const database = await runtime.getD1Database(binding);
  const directory = resolve(`../../packages/db/migrations/${authority}`);
  for (const filename of (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    const sql = await readFile(resolve(directory, filename), "utf8");
    await database.batch(
      unstable_splitSqlQuery(sql).map((statement) =>
        database.prepare(statement),
      ),
    );
  }
}

async function control(request) {
  const url = new URL(request.url);
  if (url.pathname === "/__test/access-event" && request.method === "POST")
    return (await runtime.getWorker("access-event-bridge")).fetch(request);
  if (url.pathname === "/__test/invitation/proof" && request.method === "GET") {
    const database = await runtime.getD1Database("IDENTITY_DB");
    const id = url.searchParams.get("id");
    return Response.json({
      invitation: await database
        .prepare(
          "SELECT state,accepted_by FROM workspace_invitation WHERE id=?",
        )
        .bind(id)
        .first(),
      intent: await database
        .prepare(
          "SELECT state,attempts FROM invitation_delivery_intent WHERE id=?",
        )
        .bind(id)
        .first(),
    });
  }

  if (
    url.pathname === "/__test/provider/authorize" &&
    request.method === "POST"
  ) {
    const input = await request.json();
    const authorization = new URL(input.authorizationURL);
    assert.equal(authorization.origin, "https://github.com");
    assert.equal(authorization.pathname, "/login/oauth/authorize");
    assert.equal(authorization.searchParams.get("client_id"), clientId);
    assert.equal(
      authorization.searchParams.get("redirect_uri"),
      `${origin}/api/auth/callback/github`,
    );
    assert.equal(authorization.searchParams.has("scope"), false);
    assert.equal(
      authorization.searchParams.get("code_challenge_method"),
      "S256",
    );
    assert(authorization.searchParams.get("state"));
    assert.equal(typeof input.code, "string");
    assert.equal(typeof input.subject, "number");
    codes.set(input.code, {
      subject: input.subject,
      challenge: authorization.searchParams.get("code_challenge"),
      state: authorization.searchParams.get("state"),
      attempts: 0,
      used: false,
    });
    return Response.json({ ok: true });
  }
  if (
    url.pathname === "/__test/provider/authorization" &&
    request.method === "GET"
  ) {
    const code = url.searchParams.get("code");
    const grant = codes.get(code);
    assert(grant);
    assert.equal(url.searchParams.get("state"), grant.state);
    const callback = new URL(`${origin}/api/auth/callback/github`);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", grant.state);
    return new Response(null, {
      status: 302,
      headers: { Location: callback.href },
    });
  }
  if (url.pathname === "/__test/session/expire" && request.method === "POST") {
    const input = await request.json();
    assert.equal(typeof input.sessionId, "string");
    const database = await runtime.getD1Database("IDENTITY_DB");
    await database
      .prepare(
        "UPDATE session SET expiresAt = CAST(unixepoch('subsec') * 1000 AS INTEGER) - 1 WHERE id = ?",
      )
      .bind(input.sessionId)
      .run();
    return Response.json({ ok: true });
  }
  if (url.pathname === "/__test/configuration" && request.method === "GET") {
    const results = [];
    for (const worker of misconfigured) {
      const service = await runtime.getWorker(worker.name);
      const response = await service.fetch(`${origin}/api/auth/session`);
      const body = await response.json();
      results.push({
        name: worker.name,
        status: response.status,
        body,
        cache: response.headers.get("Cache-Control"),
      });
    }
    return Response.json(results);
  }
  if (url.pathname === "/__test/proof" && request.method === "GET") {
    const code = codes.get(url.searchParams.get("code"));
    const database = await runtime.getD1Database("IDENTITY_DB");
    const subject = String(code?.subject ?? "missing");
    const user = await database
      .prepare(
        "SELECT userId FROM account WHERE providerId = 'github' AND accountId = ?",
      )
      .bind(subject)
      .first();
    const accounts = await database
      .prepare(
        "SELECT COUNT(*) AS total FROM account WHERE providerId = 'github' AND accountId = ?",
      )
      .bind(subject)
      .first();
    const personal = await database
      .prepare(
        "SELECT COUNT(*) AS total FROM workspace WHERE personal_user_id = ?",
      )
      .bind(user?.userId ?? "missing")
      .first();
    return Response.json({
      unexpectedEgress,
      tokenAttempts: code?.attempts ?? 0,
      accounts: accounts.total,
      personal: personal.total,
    });
  }
  return new Response(null, { status: 404 });
}

const temporary = await mkdtemp(resolve(tmpdir(), "holon-native-browser-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    resolve(temporary, "key.pem"),
    "-out",
    resolve(temporary, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
const server = createServer(
  {
    key: await readFile(resolve(temporary, "key.pem")),
    cert: await readFile(resolve(temporary, "cert.pem")),
  },
  async (incoming, outgoing) => {
    try {
      const parts = [];
      for await (const part of incoming) parts.push(part);
      const method = incoming.method ?? "GET";
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(name, value);
        else if (value) for (const item of value) headers.append(name, item);
      }
      // Test-only ingress isolation: emulate the Cloudflare-supplied address per scenario.
      // Keep the real persistent budgets and ignore any client-supplied CF address.
      const testClient = headers.get("X-Holon-Test-Client") ?? "anonymous";
      assert(/^(?:[0-9]{1,8}|anonymous)$/u.test(testClient));
      const syntheticAddress =
        testClient === "anonymous"
          ? "192.0.2.1"
          : `198.18.${Math.floor(Number(testClient) / 256) % 256}.${Number(testClient) % 256}`;
      headers.set("CF-Connecting-IP", syntheticAddress);
      headers.delete("X-Holon-Test-Client");
      const request = new Request(`${origin}${incoming.url}`, {
        method,
        headers,
        ...(["GET", "HEAD"].includes(method)
          ? {}
          : { body: Buffer.concat(parts) }),
      });
      const response = new URL(request.url).pathname.startsWith("/__test/")
        ? await control(request)
        : await runtime.dispatchFetch(request.url, {
            method,
            headers,
            redirect: "manual",
            ...(["GET", "HEAD"].includes(method)
              ? {}
              : { body: Buffer.concat(parts) }),
          });
      outgoing.statusCode = response.status;
      for (const [name, value] of response.headers)
        if (name !== "set-cookie") outgoing.setHeader(name, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.statusCode = 500;
      outgoing.end("Synthetic test harness failure");
    }
  },
);
server.listen(8795, "127.0.0.1");
async function stop() {
  server.close();
  await runtime.dispose();
  await rm(temporary, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
