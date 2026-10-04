import { memoryScopeMatches } from "@holon/application";
import {
  memoryIdentitySchema,
  memoryDecisionSchema,
  memoryDecisionReceiptSchema,
  memoryLimits,
  memoryObservationSchema,
  memoryRuleSchema,
  memoryRunIdentitySchema,
  memorySnapshotSchema,
  repositoryPathSchema,
  type MemoryIdentity,
  type MemoryObservation,
  type MemoryRule,
  type MemoryRunIdentity,
  type MemorySnapshot,
} from "@holon/contracts";
import { redactSecrets } from "@holon/domain";
import { DurableObject } from "cloudflare:workers";

import { createMemoryRule, memoryDigest } from "./memory-content.js";
const day = 86_400_000;

export class RepositoryMemoryObject extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS memory_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,topic TEXT NOT NULL,pr INTEGER NOT NULL,head TEXT NOT NULL,created_at TEXT NOT NULL,record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS observations_topic ON observations(topic,pr);
      CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY,topic TEXT NOT NULL,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,record TEXT NOT NULL);
    `);
    void this.ctx.blockConcurrencyWhile(async () => {
      if (
        this.meta("revoked") !== "true" &&
        (await this.ctx.storage.getAlarm()) === null
      )
        await this.ctx.storage.setAlarm(Date.now() + day);
    });
  }
  private assertIdentity(raw: MemoryIdentity): void {
    const identity = memoryIdentitySchema.parse({
      installationId: raw.installationId,
      repositoryId: raw.repositoryId,
    });
    if (this.meta("revoked") === "true")
      throw new Error("Repository memory revoked");
    const encoded = JSON.stringify(identity);
    const previous = this.meta("identity");
    if (previous !== undefined && previous !== encoded)
      throw new Error("Repository memory identity mismatch");
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO memory_meta VALUES('identity',?)",
      encoded,
    );
  }
  private meta(key: string): string | undefined {
    return this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM memory_meta WHERE key=?", key)
      .toArray()[0]?.value;
  }
  private advance(): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO memory_meta VALUES('revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",
    );
  }
  private prune(): void {
    const cutoff = new Date(
      Date.now() - memoryLimits.snapshotDays * day,
    ).toISOString();
    this.ctx.storage.sql.exec(
      "DELETE FROM decisions WHERE json_extract(record,'$.result.expiresAt') < ?",
      cutoff,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM rules WHERE json_extract(record,'$.expiresAt') < ?",
      cutoff,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM observations WHERE created_at < ?",
      new Date(Date.now() - memoryLimits.observationDays * day).toISOString(),
    );
  }
  public async record(
    raw: MemoryObservation,
  ): Promise<"recorded" | "expired" | "capacity_exceeded"> {
    const observation = memoryObservationSchema.parse(raw);
    observation.createdAt = new Date(observation.createdAt).toISOString();
    observation.summary = redactSecrets(observation.summary);
    if (observation.feedbackReason)
      observation.feedbackReason = redactSecrets(observation.feedbackReason);
    this.assertIdentity(observation.source);
    if (Date.parse(observation.createdAt) > Date.now() + 300_000)
      throw new Error("Future memory observation");
    if (
      Date.parse(observation.createdAt) <
      Date.now() - memoryLimits.observationDays * day
    )
      return "expired";
    const topic = await memoryDigest([
      observation.path,
      observation.label ?? observation.kind,
      observation.summary.replace(/\s+/gu, " ").trim(),
    ]);
    const encoded = JSON.stringify(observation);
    const admitted = this.ctx.storage.transactionSync(() => {
      this.assertIdentity(observation.source);
      this.prune();
      const existing = this.ctx.storage.sql
        .exec<{ record: string }>(
          "SELECT record FROM observations WHERE id=?",
          observation.id,
        )
        .toArray()[0];
      if (existing) {
        if (existing.record !== encoded)
          throw new Error("Memory observation identity conflict");
        return true;
      }
      const count = this.ctx.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM observations")
        .one().count;
      if (count >= memoryLimits.observations) return false;
      this.ctx.storage.sql.exec(
        "INSERT INTO observations VALUES(?,?,?,?,?,?)",
        observation.id,
        topic,
        observation.source.pullRequestNumber,
        observation.source.headSha,
        observation.createdAt,
        encoded,
      );
      this.advance();
      return true;
    });
    if (!admitted) return "capacity_exceeded";
    if (
      observation.kind === "feedback" &&
      observation.feedbackReason &&
      [
        "false_positive",
        "not_actionable",
        "wrong_severity",
        "duplicate",
      ].includes(observation.label ?? "")
    ) {
      const evidence = this.ctx.storage.sql
        .exec<{ record: string }>(
          "SELECT record FROM observations WHERE topic=? AND json_extract(record,'$.kind')='feedback' AND json_extract(record,'$.feedbackReason') IS NOT NULL GROUP BY pr ORDER BY pr LIMIT 8",
          topic,
        )
        .toArray()
        .map((row) => memoryObservationSchema.parse(JSON.parse(row.record)));
      if (evidence.length >= memoryLimits.recurrencePrs) {
        const rule = await createMemoryRule({
          root: observation.path,
          guidance:
            `Antes de repetir esta recomendação, investigue o feedback recorrente da equipe: ${observation.summary}`.slice(
              0,
              1500,
            ),
          topic,
          evidence,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(
            Date.now() + memoryLimits.ruleDays * day,
          ).toISOString(),
        });
        this.ctx.storage.transactionSync(() => {
          this.assertIdentity(observation.source);
          const exists = this.ctx.storage.sql
            .exec("SELECT id FROM rules WHERE topic=? LIMIT 1", topic)
            .toArray().length;
          if (!exists) this.insertRule(rule);
        });
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + day);
    return "recorded";
  }
  private insertRule(rule: MemoryRule): void {
    const count = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM rules")
      .one().count;
    if (count >= memoryLimits.rules)
      throw new Error("Repository memory rule limit");
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO rules VALUES(?,?,?)",
      rule.id,
      rule.topic,
      JSON.stringify(rule),
    );
    this.advance();
  }
  public async propose(
    rawIdentity: MemoryIdentity,
    rawRule: MemoryRule,
  ): Promise<MemoryRule> {
    this.assertIdentity(rawIdentity);
    const rule = memoryRuleSchema.parse(rawRule);
    if (
      rule.state !== "proposed" ||
      rule.decidedBy ||
      rule.decidedAt ||
      rule.evidence.some(
        (item) =>
          item.source.repositoryId !== rawIdentity.repositoryId ||
          item.source.installationId !== rawIdentity.installationId,
      )
    )
      throw new Error("Invalid memory proposal");
    const { id, digest, state: _state, ...content } = rule;
    if (id !== digest || (await memoryDigest(content)) !== digest)
      throw new Error("Memory proposal digest mismatch");
    this.ctx.storage.transactionSync(() => {
      this.assertIdentity(rawIdentity);
      const existing = this.readRule(id);
      if (existing) return;
      if (rule.supersedes && this.readRule(rule.supersedes)?.state !== "active")
        throw new Error("Replacement target is not active");
      this.insertRule(rule);
    });
    const saved = this.readRule(id);
    if (!saved) throw new Error("Memory proposal unavailable");
    return saved;
  }
  private readRule(id: string): MemoryRule | undefined {
    const row = this.ctx.storage.sql
      .exec<{ record: string }>("SELECT record FROM rules WHERE id=?", id)
      .toArray()[0];
    return row ? memoryRuleSchema.parse(JSON.parse(row.record)) : undefined;
  }
  public list(identity: MemoryIdentity): MemoryRule[] {
    this.assertIdentity(identity);
    return this.ctx.storage.sql
      .exec<{ record: string }>("SELECT record FROM rules ORDER BY id")
      .toArray()
      .map((row) => memoryRuleSchema.parse(JSON.parse(row.record)));
  }
  /** Only trusted ingress calls this after querying current GitHub permission. */
  public decide(
    identity: MemoryIdentity,
    input: {
      deliveryId: string;
      action: "approve" | "reject" | "revoke";
      id: string;
      digest: string;
      authorLogin: string;
    },
  ): MemoryRule {
    this.assertIdentity(identity);
    if (!memoryDecisionSchema.safeParse(input).success)
      throw new Error("Invalid memory decision");
    return this.ctx.storage.transactionSync(() => {
      const previous = this.ctx.storage.sql
        .exec<{ record: string }>(
          "SELECT record FROM decisions WHERE id=?",
          input.deliveryId,
        )
        .toArray()[0];
      if (previous) {
        const saved = memoryDecisionReceiptSchema.parse(
          JSON.parse(previous.record),
        );
        if (JSON.stringify(saved.input) !== JSON.stringify(input))
          throw new Error("Memory decision identity conflict");
        return memoryRuleSchema.parse(saved.result);
      }
      const rule = this.readRule(input.id);
      if (!rule || rule.digest !== input.digest)
        throw new Error("Memory rule digest mismatch");
      const expected = input.action === "revoke" ? "active" : "proposed";
      if (rule.state !== expected || Date.parse(rule.expiresAt) <= Date.now())
        throw new Error("Memory rule transition rejected");
      rule.state =
        input.action === "approve"
          ? "active"
          : input.action === "reject"
            ? "rejected"
            : "revoked";
      rule.decidedBy = input.authorLogin;
      rule.decidedAt = new Date().toISOString();
      if (input.action === "approve" && rule.supersedes) {
        const previousRule = this.readRule(rule.supersedes);
        if (previousRule?.state !== "active")
          throw new Error("Replacement target changed");
        previousRule.state = "superseded";
        this.ctx.storage.sql.exec(
          "UPDATE rules SET record=? WHERE id=?",
          JSON.stringify(previousRule),
          previousRule.id,
        );
      }
      this.ctx.storage.sql.exec(
        "UPDATE rules SET record=? WHERE id=?",
        JSON.stringify(rule),
        rule.id,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO decisions VALUES(?,?)",
        input.deliveryId,
        JSON.stringify({ input, result: rule }),
      );
      this.advance();
      return rule;
    });
  }
  public snapshot(
    raw: MemoryRunIdentity,
    memoryName: string,
    rawPaths: string[] = [],
  ): MemorySnapshot {
    const identity = memoryRunIdentitySchema.parse(raw);
    if (rawPaths.length > 256) throw new Error("Memory path limit exceeded");
    const paths = rawPaths.map((path) => repositoryPathSchema.parse(path));
    this.assertIdentity(identity);
    this.prune();
    const now = new Date().toISOString();
    const snapshot = memorySnapshotSchema.parse({
      identity,
      memoryName,
      revision: Number(this.meta("revision") ?? "0"),
      capturedAt: now,
      expiresAt: new Date(
        Date.now() + memoryLimits.snapshotDays * day,
      ).toISOString(),
      rules: this.list(identity).filter(
        (rule) =>
          rule.state === "active" &&
          Date.parse(rule.expiresAt) > Date.now() &&
          (!paths.length ||
            paths.some((path) => memoryScopeMatches(rule.root, path))),
      ),
      observations: this.ctx.storage.sql
        .exec<{ record: string }>(
          `SELECT record FROM observations WHERE json_extract(record,'$.kind') <> 'feedback' ${paths.length ? `AND json_extract(record,'$.path') IN (${paths.map(() => "?").join(",")})` : ""} ORDER BY created_at DESC,id LIMIT ?`,
          ...paths,
          memoryLimits.snapshotObservations,
        )
        .toArray()
        .map((row) => memoryObservationSchema.parse(JSON.parse(row.record))),
    });
    if (
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
      memoryLimits.snapshotBytes
    )
      throw new Error("Repository memory snapshot budget exceeded");
    return snapshot;
  }
  public async revoke(): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM observations; DELETE FROM rules; DELETE FROM decisions; DELETE FROM memory_meta",
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO memory_meta VALUES('revoked','true')",
      );
    });
    await this.ctx.storage.deleteAlarm();
  }
  public override async alarm(): Promise<void> {
    if (this.meta("revoked") !== "true") {
      this.prune();
      await this.ctx.storage.setAlarm(Date.now() + day);
    }
  }
}
