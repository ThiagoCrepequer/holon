import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNativeProofAuth, origin } from "../src/auth.js";
import { handlePublicAuth } from "../src/public-handler.js";
import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  interruptAccountInsert,
  setupAuth,
  signIn,
  snapshot,
} from "./support.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

const person = { id: 9001, email: "person@example.invalid" };

describe.each(["drizzle", "native-d1"] as const)(
  "%s: verified-email implicit linking policy",
  (persistence) => {
    it("does not group User and Account writes in D1.batch despite successful native recovery", async () => {
      await setupAuth(persistence);
      const auth = createNativeProofAuth(env.AUTH_DB, persistence);
      const github = fakeGitHub();
      const flow = await beginOAuth(auth);
      github.authorize("separate-writes", person, flow.authorizationURL);
      const prepare = vi.spyOn(env.AUTH_DB, "prepare");
      const batch = vi.spyOn(env.AUTH_DB, "batch");
      const response = await completeOAuth(auth, flow, "separate-writes");
      expect(response.headers.get("Location")).toBe(`${origin}/signed-in`);
      const queries = prepare.mock.calls.map(([query]) => query);
      expect(
        queries.some((query) => /insert into\s+["`]?user["`]?/i.test(query)),
      ).toBe(true);
      expect(
        queries.some((query) => /insert into\s+["`]?account["`]?/i.test(query)),
      ).toBe(true);
      expect(batch).not.toHaveBeenCalled();
    });

    it.each(["user", "session"] as const)(
      "recovers a fresh OAuth after a failed %s INSERT",
      async (table) => {
        const auth = await setupAuth(persistence);
        const github = fakeGitHub();
        await env.AUTH_DB.prepare(`CREATE TRIGGER synthetic_insert_failure BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'synthetic_insert_failure'); END`).run();
        const failed = await signIn(auth, github, `failed-${table}`, person);
        expect(failed.flow.jar.hasSession()).toBe(false);
        const interrupted = await snapshot();
        expect(interrupted.sessions).toHaveLength(0);
        expect(interrupted.users).toHaveLength(table === "user" ? 0 : 1);
        expect(interrupted.accounts).toHaveLength(table === "user" ? 0 : 1);
        await env.AUTH_DB.prepare(
          "DROP TRIGGER synthetic_insert_failure",
        ).run();
        const recovered = await signIn(
          auth,
          github,
          `recovered-${table}`,
          person,
        );
        expect(recovered.flow.state).not.toBe(failed.flow.state);
        expect(recovered.flow.jar.hasSession()).toBe(true);
        const rows = await snapshot();
        expect(rows.users).toHaveLength(1);
        expect(rows.accounts).toHaveLength(1);
        expect(rows.accounts[0]?.userId).toBe(rows.users[0]?.id);
        expect(rows.sessions).toHaveLength(1);
        if (table === "session") expect(rows.users).toEqual(interrupted.users);
      },
    );

    it.each([
      "missing-cookie",
      "foreign-cookie",
      "changed-state",
      "expired-state",
    ] as const)(
      "rejects %s before exchanging the code at GitHub",
      async (scenario) => {
        const auth = await setupAuth(persistence);
        const github = fakeGitHub();
        const flow = await beginOAuth(auth);
        github.authorize("invalid-state", person, flow.authorizationURL);
        let headers = flow.initialHeaders;
        let state = flow.state;
        if (scenario === "missing-cookie") headers = new Headers();
        if (scenario === "foreign-cookie")
          headers = (await beginOAuth(auth)).initialHeaders;
        if (scenario === "changed-state") state = "synthetic-forged-state";
        if (scenario === "expired-state") {
          const rows = await env.AUTH_DB.prepare(
            "SELECT id,value FROM verification WHERE identifier = ?",
          )
            .bind(`auth-state:${state}`)
            .all<{ id: string; value: string }>();
          const row = rows.results[0];
          expect(row).toBeDefined();
          if (!row) throw new Error("Native state was not persisted");
          const value = JSON.parse(row.value) as Record<string, unknown>;
          value.expiresAt = Date.now() - 1000;
          await env.AUTH_DB.prepare(
            "UPDATE verification SET value = ?, expiresAt = ? WHERE id = ?",
          )
            .bind(JSON.stringify(value), Date.now() - 1000, row.id)
            .run();
        }
        const response = await handlePublicAuth(
          auth,
          new Request(
            `${origin}/api/auth/callback/github?state=${encodeURIComponent(state)}&code=invalid-state`,
            { headers },
          ),
        );
        expect(response.headers.get("Location")).toContain("state_mismatch");
        expect(github.exchanges).toBe(0);
        const rows = await snapshot();
        expect(rows.users).toHaveLength(0);
        expect(rows.accounts).toHaveLength(0);
        expect(rows.sessions).toHaveLength(0);
      },
    );

    it("blocks an already exchanged code before egress even with a fresh valid state", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      await signIn(auth, github, "single-use", person);
      const before = await snapshot();
      const fresh = await beginOAuth(auth);
      const response = await completeOAuth(auth, fresh, "single-use");
      expect(response.headers.get("Location")).not.toBe(`${origin}/signed-in`);
      expect(fresh.jar.hasSession()).toBe(false);
      expect(github.exchanges).toBe(1);
      expect(await snapshot()).toEqual(before);
    });

    it("links another verified provider subject to the existing verified User", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      await signIn(auth, github, "original", person);
      const before = await snapshot();
      const linked = await signIn(auth, github, "new-subject", {
        ...person,
        id: 9002,
      });
      expect(linked.response.headers.get("Location")).toBe(
        `${origin}/signed-in`,
      );
      expect(linked.flow.jar.hasSession()).toBe(true);
      const after = await snapshot();
      expect(after.users).toEqual(before.users);
      expect(after.accounts).toHaveLength(2);
      expect(after.accounts.map((account) => account.accountId)).toEqual(
        expect.arrayContaining(["9001", "9002"]),
      );
      expect(
        after.accounts.every(
          (account) => account.userId === before.users[0]?.id,
        ),
      ).toBe(true);
      expect(after.sessions).toHaveLength(2);
    });

    it("rejects linking when GitHub does not verify the incoming email", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      await signIn(auth, github, "original", person);
      const before = await snapshot();
      const rejected = await signIn(auth, github, "unverified", {
        ...person,
        id: 9002,
        verified: false,
      });
      expect(
        new URL(
          String(rejected.response.headers.get("Location")),
        ).searchParams.get("error"),
      ).toBe("account_not_linked");
      expect(rejected.flow.jar.hasSession()).toBe(false);
      expect(await snapshot()).toEqual(before);
    });

    it("does not let a verified incoming subject claim a locally unverified User", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      // Native signup allows an unverified email; it must not become proof of ownership for linking.
      const original = await signIn(auth, github, "unverified-signup", {
        ...person,
        verified: false,
      });
      expect(original.flow.jar.hasSession()).toBe(true);
      const before = await snapshot();
      expect(before.users[0]?.emailVerified).toBe(0);
      const rejected = await signIn(auth, github, "verified-incoming", {
        ...person,
        id: 9002,
      });
      expect(
        new URL(
          String(rejected.response.headers.get("Location")),
        ).searchParams.get("error"),
      ).toBe("account_not_linked");
      expect(rejected.flow.jar.hasSession()).toBe(false);
      expect(await snapshot()).toEqual(before);
    });

    it("keeps the existing provider subject bound to its User after an email change, even when the new email belongs to another User", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      await signIn(auth, github, "original", person);
      const originalUser = (await snapshot()).users[0]?.id;
      const otherIdentity = { id: 9002, email: "other@example.invalid" };
      await signIn(auth, github, "other", otherIdentity);
      const changed = await signIn(auth, github, "changed-email", {
        ...person,
        email: otherIdentity.email,
      });
      expect(changed.flow.jar.hasSession()).toBe(true);
      const after = await snapshot();
      expect(after.users).toHaveLength(2);
      expect(after.accounts).toHaveLength(2);
      expect(
        after.accounts.find((account) => account.accountId === "9001")?.userId,
      ).toBe(originalUser);
      const context = await auth.api.getSession({
        headers: changed.flow.jar.headers(),
      });
      expect(context?.user.id).toBe(originalUser);
    });

    it("recovers a failed link on a fresh OAuth without changing User or invalidating its existing session", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      const original = await signIn(auth, github, "original", person);
      const before = await snapshot();
      await interruptAccountInsert();
      const failed = await signIn(auth, github, "failed-link", {
        ...person,
        id: 9002,
      });
      expect(failed.flow.jar.hasSession()).toBe(false);
      expect(
        new URL(
          String(failed.response.headers.get("Location")),
        ).searchParams.get("error"),
      ).toBe("unable_to_link_account");
      expect(await snapshot()).toEqual(before);
      expect(
        (await auth.api.getSession({ headers: original.flow.jar.headers() }))
          ?.user.id,
      ).toBe(before.users[0]?.id);
      await env.AUTH_DB.prepare(
        "DROP TRIGGER synthetic_account_insert_failure",
      ).run();
      const recovered = await signIn(auth, github, "fresh-link", {
        ...person,
        id: 9002,
      });
      expect(recovered.flow.state).not.toBe(failed.flow.state);
      expect(recovered.flow.jar.hasSession()).toBe(true);
      const after = await snapshot();
      expect(after.users).toEqual(before.users);
      expect(after.accounts).toHaveLength(2);
      expect(after.sessions).toHaveLength(2);
    });

    it("converges concurrent verified-email links without duplicate User or provider subject", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      await signIn(auth, github, "original", person);
      const before = await snapshot();
      const left = await beginOAuth(auth);
      const right = await beginOAuth(auth);
      const incoming = { ...person, id: 9002 };
      github.authorize("left-link", incoming, left.authorizationURL);
      github.authorize("right-link", incoming, right.authorizationURL);
      await Promise.all([
        completeOAuth(auth, left, "left-link"),
        completeOAuth(auth, right, "right-link"),
      ]);
      const recovered = await signIn(auth, github, "after-link-race", incoming);
      expect(recovered.flow.jar.hasSession()).toBe(true);
      const after = await snapshot();
      expect(after.users).toEqual(before.users);
      expect(after.accounts).toHaveLength(2);
      expect(
        after.accounts.every(
          (account) => account.userId === before.users[0]?.id,
        ),
      ).toBe(true);
      expect(
        after.accounts.filter((account) => account.accountId === "9002"),
      ).toHaveLength(1);
    });
  },
);
