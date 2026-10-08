import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it } from "vitest";

import { createPreferencesPersistence } from "../src/preferences.server.js";

const bindings = env as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
const actor: AdmittedUser = {
  id: "prefs_user",
  name: "Synthetic",
  sessionId: "prefs_session",
  githubAccountId: "prefs_subject",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
afterEach(async () => {
  await reset();
});

async function setup() {
  await applyD1Migrations(bindings.IDENTITY_DB, bindings.IDENTITY_MIGRATIONS);
  const now = Date.now();
  await bindings.IDENTITY_DB.batch([
    bindings.IDENTITY_DB.prepare(
      "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('prefs_user','Synthetic','prefs@example.invalid',1,?,?)",
    ).bind(now, now),
    bindings.IDENTITY_DB.prepare(
      "INSERT INTO account (id,userId,providerId,accountId,createdAt,updatedAt) VALUES ('prefs_account','prefs_user','github','prefs_subject',?,?)",
    ).bind(now, now),
    bindings.IDENTITY_DB.prepare(
      "INSERT INTO session (id,userId,token,createdAt,updatedAt,expiresAt) VALUES ('prefs_session','prefs_user','synthetic-prefs-token',?,?,?)",
    ).bind(now, now, now + 60_000),
    bindings.IDENTITY_DB.prepare(
      "INSERT INTO session (id,userId,token,createdAt,updatedAt,expiresAt) VALUES ('other_device','prefs_user','synthetic-other-token',?,?,?)",
    ).bind(now, now, now + 60_000),
  ]);
  return createPreferencesPersistence(bindings.IDENTITY_DB);
}

it("distinguishes no saved preference from an explicit UTC choice and persists between devices", async () => {
  const prefs = await setup();
  expect(await prefs.readPreferences(actor)).toEqual({
    locale: null,
    timezone: null,
  });
  const input = { locale: "pt-BR" as const, timezone: "America/Sao_Paulo" };
  expect(await prefs.updatePreferences(actor, input)).toEqual(input);
  expect(
    await prefs.readPreferences({ ...actor, sessionId: "other_device" }),
  ).toEqual(input);
  const utc = { locale: "en" as const, timezone: "UTC" };
  expect(await prefs.updatePreferences(actor, utc)).toEqual(utc);
  expect(await prefs.readPreferences(actor)).toEqual(utc);
  expect(
    await bindings.IDENTITY_DB.prepare(
      "SELECT locale, timezone FROM user_preference WHERE user_id='prefs_user'",
    ).first(),
  ).toEqual(utc);
});

it("rechecks the exact session at the write and leaves the saved profile unchanged on denial", async () => {
  const prefs = await setup();
  const confirmed = { locale: "en" as const, timezone: "UTC" };
  await prefs.updatePreferences(actor, confirmed);
  let armed = true;
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === "first")
          return async () => {
            if (armed) {
              armed = false;
              await bindings.IDENTITY_DB.prepare(
                "DELETE FROM session WHERE id='prefs_session'",
              ).run();
            }
            return target.first();
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  const database = new Proxy(bindings.IDENTITY_DB, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) =>
          sql.includes("INSERT INTO user_preference")
            ? wrap(target.prepare(sql))
            : target.prepare(sql);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    createPreferencesPersistence(database).updatePreferences(actor, {
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
    }),
  ).rejects.toThrow("user_not_admitted");
  expect(armed).toBe(false);
  expect(
    await bindings.IDENTITY_DB.prepare(
      "SELECT locale, timezone FROM user_preference WHERE user_id='prefs_user'",
    ).first(),
  ).toEqual(confirmed);
});

it.each(["other_device", "prefs_session"])(
  "rejects a wrong User or GitHub subject despite active %s",
  async (sessionId) => {
    const prefs = await setup();
    for (const untrusted of [
      { ...actor, sessionId, id: "other_user" },
      { ...actor, sessionId, githubAccountId: "other_subject" },
    ]) {
      await expect(prefs.readPreferences(untrusted)).rejects.toThrow(
        "user_not_admitted",
      );
      await expect(
        prefs.updatePreferences(untrusted, { locale: "en", timezone: "UTC" }),
      ).rejects.toThrow("user_not_admitted");
    }
    expect(
      await bindings.IDENTITY_DB.prepare(
        "SELECT COUNT(*) FROM user_preference",
      ).first("COUNT(*)"),
    ).toBe(0);
  },
);

it("rejects expired sessions and invalid preferences without a write", async () => {
  const prefs = await setup();
  await expect(
    prefs.updatePreferences(actor, { locale: "en", timezone: "+02:00" }),
  ).rejects.toThrow("invalid_preferences");
  await bindings.IDENTITY_DB.prepare(
    "UPDATE session SET expiresAt=0 WHERE id='prefs_session'",
  ).run();
  await expect(prefs.readPreferences(actor)).rejects.toThrow(
    "user_not_admitted",
  );
  await expect(
    prefs.updatePreferences(actor, { locale: "en", timezone: "UTC" }),
  ).rejects.toThrow("user_not_admitted");
  expect(
    await bindings.IDENTITY_DB.prepare(
      "SELECT COUNT(*) FROM user_preference",
    ).first("COUNT(*)"),
  ).toBe(0);
});

it("fails closed on a corrupted stored timezone", async () => {
  const prefs = await setup();
  await bindings.IDENTITY_DB.prepare(
    "INSERT INTO user_preference (user_id,locale,timezone,updated_at) VALUES ('prefs_user','en','Mars/Olympus',0)",
  ).run();
  await expect(prefs.readPreferences(actor)).rejects.toThrow(
    "storage_corrupted",
  );
});

it("reports unavailable reads without fabricating a default preference", async () => {
  await setup();
  const unavailable = new Proxy(bindings.IDENTITY_DB, {
    get(target, property) {
      if (property === "prepare")
        return () => {
          throw new Error("Synthetic storage failure");
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    createPreferencesPersistence(unavailable).readPreferences(actor),
  ).rejects.toThrow("storage_unavailable");
});

it("an ambiguous committed update reports unknown and retry assigns the same value once", async () => {
  const prefs = await setup();
  let lost = true;
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === "first")
          return async () => {
            const result = await target.first();
            if (lost) {
              lost = false;
              throw new Error("Synthetic lost response after commit");
            }
            return result;
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  const uncertain = new Proxy(bindings.IDENTITY_DB, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) =>
          sql.includes("INSERT INTO user_preference")
            ? wrap(target.prepare(sql))
            : target.prepare(sql);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const input = { locale: "pt-BR" as const, timezone: "America/Sao_Paulo" };
  await expect(
    createPreferencesPersistence(uncertain).updatePreferences(actor, input),
  ).rejects.toThrow("command_unknown");
  expect(
    await bindings.IDENTITY_DB.prepare(
      "SELECT locale, timezone FROM user_preference WHERE user_id='prefs_user'",
    ).first(),
  ).toEqual(input);
  expect(await prefs.updatePreferences(actor, input)).toEqual(input);
  expect(
    await bindings.IDENTITY_DB.prepare(
      "SELECT COUNT(*) FROM user_preference",
    ).first("COUNT(*)"),
  ).toBe(1);
});
