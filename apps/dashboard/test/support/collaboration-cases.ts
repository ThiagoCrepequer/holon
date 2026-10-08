import type { GitHubUserService } from "@holon/auth/server";
import type { AdmittedUser } from "@holon/contracts/dashboard";
import { createConnectionPersistence } from "@holon/db/identity/server";
import { expect, it, vi } from "vitest";

import { createWorkspaceCollaboration } from "../../app/server/collaboration.server.js";
const actor: AdmittedUser = {
  id: "actor",
  name: "Synthetic",
  sessionId: "session",
  githubAccountId: "101",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

export async function seedCollaboration(database: D1Database) {
  const now = Date.now();
  await database.batch([
    database
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('actor','Synthetic','actor@example.invalid',1,?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO account(id,userId,providerId,accountId,accessToken,createdAt,updatedAt) VALUES('account','actor','github','101','synthetic-cipher',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO session(id,userId,token,createdAt,updatedAt,expiresAt) VALUES('session','actor','synthetic',?,?,?)",
      )
      .bind(now, now, now + 3600000),
    database
      .prepare(
        "INSERT INTO workspace(id,type,name,created_at,updated_at) VALUES('team','team','Synthetic',?,?)",
      )
      .bind(now, now),
    database
      .prepare("INSERT INTO membership VALUES('team','actor','owner',?,?)")
      .bind(now, now),
  ]);
}
export function collaborationCases(database: () => D1Database) {
  function fixture() {
    const github = {
      status: vi.fn(async () => ({ status: "connected" as const })),
      identity: vi.fn(async () => ({ accountId: "account", generation: 1 })),
      verifyInstallation: vi.fn(async () => ({
        accountId: "account",
        credentialGeneration: 1,
        installationId: 77,
        accountOwnerId: 101,
      })),
      recipient: vi.fn(async () => ({
        accountId: "account",
        generation: 1,
        verifiedEmails: ["recipient@example.invalid"],
      })),
      repositories: vi.fn(async () => ({
        accountId: "account",
        generation: 1,
        repositoryIds: [901, 902],
      })),
    } satisfies GitHubUserService;
    return {
      github,
      service: createWorkspaceCollaboration(database(), github),
    };
  }
  async function confirmed(id: string, action = "link") {
    await database()
      .prepare(
        "INSERT INTO reauth_intent(id,user_id,account_id,original_session_id,proof_session_id,workspace_id,action,target_user_id,created_at,expires_at,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        actor.id,
        actor.githubAccountId,
        "original",
        actor.sessionId,
        "team",
        action,
        "77",
        Date.now(),
        Date.now() + 300000,
        Date.now(),
      )
      .run();
    return { installationId: 77, reauthIntentId: id };
  }
  it("composes link, current status, full grants and cache before projection pagination", async () => {
    const { github, service } = fixture();
    expect(await service.connectionStatus(actor)).toEqual({
      status: "connected",
    });
    expect(
      (await service.createConnectionReauth(actor, "team", 77, "link"))
        .reauthIntentId,
    ).toContain("reauth");
    expect(
      await service.linkInstallation(actor, "team", await confirmed("proof")),
    ).toMatchObject({ installationId: 77, state: "active" });
    expect(await service.listConnections(actor, "team")).toHaveLength(1);
    expect(await service.authorizeReviews(actor, "team")).toEqual({
      userId: "actor",
      workspaceId: "team",
      repositoryIds: [901, 902],
    });
    expect(await service.authorizeReviews(actor, "team")).toMatchObject({
      repositoryIds: [901, 902],
    });
    expect(github.repositories).toHaveBeenCalledTimes(1);
    await service.unlinkInstallation(
      actor,
      "team",
      await confirmed("unlink", "unlink"),
    );
    expect(
      (await service.authorizeReviews(actor, "team")).repositoryIds,
    ).toEqual([]);
  });
  it("records/cancels invitation and verifies recipient before acceptance", async () => {
    const { service } = fixture();
    const invite = await service.createInvitation(actor, "team", {
      operationId: "integration",
      email: "recipient@example.invalid",
      locale: "en",
    });
    expect(
      (await service.listInvitations(actor, "team")).some(
        (i) => i.id === invite.id,
      ),
    ).toBe(true);
    expect(await service.acceptInvitation(actor, invite.id)).toEqual({
      status: "accepted",
      membershipActive: true,
    });
    const canceled = await service.createInvitation(actor, "team", {
      operationId: "cancel",
      email: "recipient@example.invalid",
      locale: "en",
    });
    expect(
      (await service.cancelInvitation(actor, "team", canceled.id)).state,
    ).toBe("canceled");
  });
  it("negative cache is complete and unknown provider outcome never becomes an empty success", async () => {
    const { github, service } = fixture();
    await service.linkInstallation(actor, "team", await confirmed("proof"));
    github.repositories.mockResolvedValue({
      accountId: "account",
      generation: 1,
      repositoryIds: [],
    });
    expect(
      (await service.authorizeReviews(actor, "team")).repositoryIds,
    ).toEqual([]);
    expect(
      (await service.authorizeReviews(actor, "team")).repositoryIds,
    ).toEqual([]);
    expect(github.repositories).toHaveBeenCalledTimes(1);
    await database().prepare("DELETE FROM github_grant_cache").run();
    github.repositories.mockRejectedValue(new Error("synthetic outage"));
    await expect(service.authorizeReviews(actor, "team")).rejects.toThrow();
  });
  it("stale provider generation and unlink of a foreign installation are denied", async () => {
    const { github, service } = fixture();
    await service.linkInstallation(actor, "team", await confirmed("proof"));
    github.repositories.mockResolvedValue({
      accountId: "account",
      generation: 2,
      repositoryIds: [901],
    });
    await expect(service.authorizeReviews(actor, "team")).rejects.toMatchObject(
      {
        code: "reconnect_required",
      },
    );
    await expect(
      service.unlinkInstallation(actor, "team", {
        installationId: 78,
        reauthIntentId: "unknown",
      }),
    ).rejects.toMatchObject({ code: "denied" });
  });
  it("event racing provider resolution fences cache installation and final scope", async () => {
    const { github, service } = fixture();
    await service.linkInstallation(actor, "team", await confirmed("proof"));
    github.repositories.mockImplementation(async () => {
      await createConnectionPersistence(database()).applyEvent({
        deliveryId: "event",
        installationId: 77,
        action: "suspended",
      });
      return { accountId: "account", generation: 1, repositoryIds: [901] };
    });
    await expect(service.authorizeReviews(actor, "team")).rejects.toMatchObject(
      {
        code: "denied",
      },
    );
    expect(
      await database()
        .prepare("SELECT COUNT(*) AS n FROM github_grant_cache")
        .first(),
    ).toEqual({ n: 0 });
  });
  it("an early cached grant expiring during another installation query cannot authorize the aggregate scope", async () => {
    const { github, service } = fixture();
    await service.linkInstallation(actor, "team", await confirmed("first"));
    await service.authorizeReviews(actor, "team");
    await database()
      .prepare(
        "INSERT INTO github_connection VALUES(88,'team',101,'active',1,'actor',?)",
      )
      .bind(Date.now())
      .run();
    github.repositories.mockImplementation(async () => {
      await database()
        .prepare(
          "UPDATE github_grant_cache SET expires_at=0 WHERE installation_id=77",
        )
        .run();
      return { accountId: "account", generation: 1, repositoryIds: [903] };
    });
    await expect(service.authorizeReviews(actor, "team")).rejects.toMatchObject(
      { code: "denied" },
    );
  });
}
