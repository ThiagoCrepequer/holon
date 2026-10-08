import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, beforeEach } from "vitest";

import {
  seedCollaboration,
  collaborationCases,
} from "./support/collaboration-cases.js";
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    compatibilityDate: "2026-08-29",
    modules: true,
    script: "export default {fetch(){return new Response(null,{status:404});}}",
    d1Databases: ["IDENTITY_DB"],
  }),
);
let database: D1Database;
beforeAll(async () => {
  database = await runtime.getD1Database("IDENTITY_DB");
  for (const migration of await readD1Migrations(
    "../../packages/db/migrations/identity",
  ))
    await database.batch(migration.queries.map((sql) => database.prepare(sql)));
  await seedCollaboration(database);
});
afterAll(async () => runtime.dispose());
beforeEach(async () => {
  await database.batch([
    database.prepare("DELETE FROM github_grant_cache"),
    database.prepare("DELETE FROM github_connection"),
    database.prepare("DELETE FROM reauth_intent"),
  ]);
});
collaborationCases(() => database);
