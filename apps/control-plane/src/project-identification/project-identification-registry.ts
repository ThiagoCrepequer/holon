import { DurableObject } from "cloudflare:workers";
/** Installation-scoped index: revocations are durable before cache cleanup starts. */
export class ProjectIdentificationRegistryObject extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS repositories(id INTEGER PRIMARY KEY, cache_name TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, purged INTEGER NOT NULL DEFAULT 0)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS purge_queue(name TEXT PRIMARY KEY)",
    );
  }
  public async register(
    installationId: number,
    repositoryId: number,
  ): Promise<string | null> {
    if (
      !Number.isSafeInteger(installationId) ||
      installationId <= 0 ||
      !Number.isSafeInteger(repositoryId) ||
      repositoryId <= 0
    )
      throw new TypeError("Invalid repository identity");
    if (await this.ctx.storage.get<boolean>("revoked")) return null;
    const name = `${installationId}/${repositoryId}`;
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO repositories(id,cache_name) VALUES(?,?)",
      repositoryId,
      name,
    );
    const row = this.ctx.storage.sql
      .exec<{ revoked: number; cache_name: string }>(
        "SELECT revoked,cache_name FROM repositories WHERE id=?",
        repositoryId,
      )
      .one();
    return row.revoked ? null : row.cache_name;
  }
  public async revoke(
    installationId: number,
    repositoryIds: number[] | null,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(installationId) ||
      installationId <= 0 ||
      repositoryIds?.some((id) => !Number.isSafeInteger(id) || id <= 0)
    )
      throw new TypeError("Invalid revocation identity");
    if (repositoryIds === null) {
      await this.ctx.storage.put("revoked", true);
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO purge_queue SELECT cache_name FROM repositories",
      );
    } else
      for (const id of repositoryIds)
        this.ctx.storage.sql.exec(
          "INSERT INTO repositories(id,cache_name,revoked) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET revoked=1,purged=0",
          id,
          `${installationId}/${id}`,
        );
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO purge_queue SELECT cache_name FROM repositories WHERE revoked=1",
    );
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    await this.purgeBatch();
  }
  public async restore(
    installationId: number,
    repositoryIds: number[] | null,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(installationId) ||
      installationId <= 0 ||
      repositoryIds?.some((id) => !Number.isSafeInteger(id) || id <= 0)
    )
      throw new TypeError("Invalid restoration identity");
    if (repositoryIds === null) {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO purge_queue SELECT cache_name FROM repositories WHERE revoked=0",
      );
      const rows = this.ctx.storage.sql
        .exec<{ id: number }>("SELECT id FROM repositories WHERE revoked=0")
        .toArray();
      for (const row of rows)
        this.ctx.storage.sql.exec(
          "UPDATE repositories SET cache_name=? WHERE id=?",
          `${installationId}/${row.id}/${crypto.randomUUID()}`,
          row.id,
        );
      await this.ctx.storage.delete("revoked");
    } else
      for (const id of repositoryIds) {
        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO purge_queue SELECT cache_name FROM repositories WHERE id=?",
          id,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO repositories(id,cache_name,revoked) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET cache_name=excluded.cache_name,revoked=0",
          id,
          `${installationId}/${id}/${crypto.randomUUID()}`,
        );
      }
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    await this.purgeBatch();
  }
  private async purgeBatch(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<{ name: string }>("SELECT name FROM purge_queue LIMIT 25")
      .toArray();
    for (const row of rows) {
      await this.env.PROJECT_IDENTIFICATION_CACHE.getByName(row.name).revoke();
      this.ctx.storage.sql.exec(
        "DELETE FROM purge_queue WHERE name=?",
        row.name,
      );
    }
    const remaining = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM purge_queue")
      .one().count;
    if (remaining) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }
  public override async alarm(): Promise<void> {
    await this.purgeBatch();
  }
}
