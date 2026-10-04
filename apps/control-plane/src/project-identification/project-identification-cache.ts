import type { IdentificationCacheClaim } from "@holon/application";
import { identifiedProjectSchema } from "@holon/contracts";
import { DurableObject } from "cloudflare:workers";
const keySchema = {
  parse(value: string) {
    if (!/^[a-f0-9]{64}$/u.test(value))
      throw new TypeError("Invalid cache key");
    return value;
  },
};
const ownerSchema = {
  parse(value: string) {
    if (value.length < 1 || value.length > 200)
      throw new TypeError("Invalid cache owner");
    return value;
  },
};
interface CacheRow extends Record<string, SqlStorageValue> {
  key: string;
  owner: string;
  generation: number;
  lease: number;
  attempts: number;
  payload: string | null;
  expires: number;
  used: number;
}
const ttl = 90 * 86400000;
export class ProjectIdentificationCacheObject extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, owner TEXT NOT NULL, generation INTEGER NOT NULL, lease INTEGER NOT NULL, attempts INTEGER NOT NULL, payload TEXT, expires INTEGER NOT NULL, used INTEGER NOT NULL)",
    );
  }
  private claimRunBudget(owner: string): boolean {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS run_budgets(owner TEXT PRIMARY KEY,calls INTEGER NOT NULL,started INTEGER NOT NULL)",
    );
    const now = Date.now();
    const capacity = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM run_budgets WHERE owner<>?",
        owner,
      )
      .one().count;
    if (capacity >= 10000) return false;
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO run_budgets VALUES(?,0,?)",
      owner,
      now,
    );
    const row = this.ctx.storage.sql
      .exec<{ calls: number; started: number }>(
        "SELECT calls,started FROM run_budgets WHERE owner=?",
        owner,
      )
      .one();
    if (row.calls >= 8 || now - row.started >= 120000) return false;
    this.ctx.storage.sql.exec(
      "UPDATE run_budgets SET calls=calls+1 WHERE owner=?",
      owner,
    );
    return true;
  }
  private row(key: string): CacheRow | undefined {
    return this.ctx.storage.sql
      .exec<CacheRow>("SELECT * FROM entries WHERE key=?", key)
      .toArray()[0];
  }
  public async claim(
    rawKey: string,
    rawOwner: string,
  ): Promise<IdentificationCacheClaim> {
    const key = keySchema.parse(rawKey),
      owner = ownerSchema.parse(rawOwner),
      now = Date.now();
    if (await this.ctx.storage.get<boolean>("revoked"))
      return { status: "unavailable" };
    this.prune(now);
    const row = this.row(key);
    if (
      !row &&
      this.ctx.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM entries")
        .one().count >= 1000
    )
      return { status: "unavailable" };
    if (row?.payload && row.expires > now) {
      let result;
      try {
        result = identifiedProjectSchema.safeParse(
          JSON.parse(row.payload) as unknown,
        );
      } catch {
        result = undefined;
      }
      if (result?.success && result.data.fingerprint === key) {
        this.ctx.storage.sql.exec(
          "UPDATE entries SET used=?, expires=? WHERE key=?",
          now,
          now + ttl,
          key,
        );
        return { status: "hit", project: result.data };
      }
    }
    if (row && row.lease > now)
      return { status: "pending", retryAt: row.lease };
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS fence(id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO fence VALUES(1,1) ON CONFLICT(id) DO UPDATE SET generation=generation+1",
    );
    const token = this.ctx.storage.sql
      .exec<{ generation: number }>("SELECT generation FROM fence WHERE id=1")
      .one().generation;
    // Attempts survive owner retries; another run can retry after the cooldown.
    const attempts = row && row.owner === owner ? row.attempts : 0;
    if (attempts >= 2) return { status: "unavailable" };
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO entries VALUES(?,?,?,?,?,NULL,?,?)",
      key,
      owner,
      token,
      now + 90000,
      attempts,
      now + ttl,
      now,
    );
    await this.ctx.storage.setAlarm(now + 300000);
    return { status: "claimed", token };
  }
  public async attempt(
    rawKey: string,
    owner: string,
    token: number,
  ): Promise<boolean> {
    const key = keySchema.parse(rawKey);
    if (await this.ctx.storage.get<boolean>("revoked")) return false;
    const row = this.row(key);
    if (
      !row ||
      row.owner !== owner ||
      row.generation !== token ||
      row.lease <= Date.now() ||
      row.attempts >= 2
    )
      return false;
    if (!this.claimRunBudget(owner)) return false;
    this.ctx.storage.sql.exec(
      "UPDATE entries SET attempts=attempts+1 WHERE key=?",
      key,
    );
    return true;
  }
  public async complete(
    rawKey: string,
    owner: string,
    token: number,
    rawProject: unknown,
  ): Promise<boolean> {
    const key = keySchema.parse(rawKey);
    const project = identifiedProjectSchema.parse(rawProject);
    if (
      project.fingerprint !== key ||
      (await this.ctx.storage.get<boolean>("revoked"))
    )
      return false;
    const row = this.row(key);
    const now = Date.now();
    if (
      !row ||
      row.owner !== owner ||
      row.generation !== token ||
      row.lease <= now
    )
      return false;
    this.ctx.storage.sql.exec(
      "UPDATE entries SET payload=?,lease=0,used=?,expires=? WHERE key=?",
      JSON.stringify(project),
      now,
      now + ttl,
      key,
    );
    this.prune(now);
    return true;
  }
  public async fail(
    rawKey: string,
    owner: string,
    token: number,
  ): Promise<void> {
    const key = keySchema.parse(rawKey);
    this.ctx.storage.sql.exec(
      "UPDATE entries SET lease=? WHERE key=? AND owner=? AND generation=?",
      Date.now() + 300000,
      key,
      owner,
      token,
    );
    await this.ctx.storage.setAlarm(Date.now() + 300000);
  }
  public async revoke(): Promise<void> {
    // Tombstone survives cleanup so in-flight callers can never resurrect entries.
    await this.ctx.storage.put("revoked", true);
    this.ctx.storage.sql.exec("DELETE FROM entries");
    this.ctx.storage.sql.exec("DROP TABLE IF EXISTS run_budgets");
    await this.ctx.storage.deleteAlarm();
  }
  private prune(now: number): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS run_budgets(owner TEXT PRIMARY KEY,calls INTEGER NOT NULL,started INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM run_budgets WHERE started<?",
      now - ttl,
    );
    this.ctx.storage.sql.exec("DELETE FROM entries WHERE expires<=?", now);
    const rows = this.ctx.storage.sql
      .exec<{ key: string; bytes: number }>(
        "SELECT key,length(CAST(payload AS BLOB)) AS bytes FROM entries ORDER BY used DESC",
      )
      .toArray();
    let bytes = 0;
    for (const [i, row] of rows.entries()) {
      bytes += row.bytes ?? 0;
      if (i >= 1000 || bytes > 16777216)
        this.ctx.storage.sql.exec("DELETE FROM entries WHERE key=?", row.key);
    }
  }
  public override async alarm(): Promise<void> {
    this.prune(Date.now());
    const next = this.ctx.storage.sql
      .exec<{ expires: number }>("SELECT MIN(expires) AS expires FROM entries")
      .toArray()[0]?.expires;
    if (next)
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 300000, next));
  }
}
