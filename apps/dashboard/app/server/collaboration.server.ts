import type { WorkspaceCollaborationPort } from "@holon/application/collaboration-ports";
import type { GitHubUserService } from "@holon/auth/server";
import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  createConnectionPersistence,
  createGrantPersistence,
  createInvitationPersistence,
  CollaborationError,
} from "@holon/db/identity/server";

export function createWorkspaceCollaboration(
  database: D1Database,
  github: GitHubUserService,
): WorkspaceCollaborationPort & {
  createConnectionReauth: ReturnType<
    typeof createConnectionPersistence
  >["createReauth"];
} {
  const connections = createConnectionPersistence(database);
  const grants = createGrantPersistence(database);
  const invitations = createInvitationPersistence(database);
  return {
    createConnectionReauth: (actor, workspaceId, id, action) =>
      connections.createReauth(actor, workspaceId, id, action),
    createInvitation: (actor, workspaceId, input) =>
      invitations.create(actor, workspaceId, input),
    listInvitations: (actor, workspaceId) =>
      invitations.list(actor, workspaceId),
    cancelInvitation: (actor, workspaceId, id) =>
      invitations.cancel(actor, workspaceId, id),
    listConnections: (actor, workspaceId) =>
      connections.list(actor, workspaceId),
    connectionStatus: (actor) => github.status(actor),
    async acceptInvitation(actor, id) {
      return invitations.accept(actor, id, await github.recipient(actor));
    },
    async linkInstallation(actor, workspaceId, input) {
      // Local admission precedes private provider reads; final mutation revalidates it.
      await connections.list(actor, workspaceId);
      const proof = await github.verifyInstallation(
        actor,
        input.installationId,
      );
      const result = await connections.mutate(
        actor,
        workspaceId,
        input,
        "link",
        proof,
      );
      if (!result) throw new CollaborationError("command_unknown");
      return result;
    },
    async unlinkInstallation(actor, workspaceId, input) {
      const links = await connections.list(actor, workspaceId);
      if (!links.some((l) => l.installationId === input.installationId))
        throw new CollaborationError("denied");
      const identity = await github.identity(actor);
      await connections.mutate(actor, workspaceId, input, "unlink", {
        accountId: identity.accountId,
        credentialGeneration: identity.generation,
        installationId: input.installationId,
        accountOwnerId: 1,
      });
      return { unlinked: true };
    },
    async authorizeReviews(actor: AdmittedUser, workspaceId: string) {
      const startedAt = Date.now();
      try {
        const links = await connections.list(actor, workspaceId);
        const active = links.filter((l) => l.state === "active");
        const identity = await github.identity(actor);
        const repositories: { installationId: number; repositoryId: number }[] =
          [];
        const authorized: {
          installationId: number;
          generation: number;
          grantExpiresAt: number;
        }[] = [];
        for (const link of active) {
          const key = {
            accountId: identity.accountId,
            credentialGeneration: identity.generation,
            installationId: link.installationId,
            connectionGeneration: link.generation,
          };
          let grant = await grants.read(actor, workspaceId, key);
          if (grant === null) {
            const observedAt = Date.now();
            const proof = await github.repositories(actor, link.installationId);
            if (
              proof.accountId !== identity.accountId ||
              proof.generation !== identity.generation
            )
              throw new CollaborationError("reconnect_required");
            if (
              !(await grants.write(
                actor,
                workspaceId,
                key,
                proof.repositoryIds,
                observedAt,
              ))
            )
              throw new CollaborationError("denied");
            grant = {
              repositoryIds: proof.repositoryIds,
              expiresAt: observedAt + 60000,
            };
          }
          authorized.push({ ...link, grantExpiresAt: grant.expiresAt });
          for (const id of grant.repositoryIds)
            repositories.push({
              installationId: link.installationId,
              repositoryId: id,
            });
        }
        await grants.assertCurrent(
          actor,
          workspaceId,
          identity.accountId,
          identity.generation,
          authorized,
        );
        console.info(
          JSON.stringify({
            event: "github_authority_health",
            code: 0,
            duration_ms: Date.now() - startedAt,
            repositories: repositories.length,
          }),
        );
        return {
          userId: actor.id,
          workspaceId,
          repositories: repositories.toSorted(
            (a, b) =>
              a.installationId - b.installationId ||
              a.repositoryId - b.repositoryId,
          ),
        };
      } catch (error) {
        console.info(
          JSON.stringify({
            event: "github_authority_health",
            code:
              error instanceof CollaborationError
                ? error.code === "reconnect_required"
                  ? 2
                  : error.code === "denied"
                    ? 1
                    : 3
                : 3,
            duration_ms: Date.now() - startedAt,
          }),
        );
        throw error;
      }
    },
  };
}
