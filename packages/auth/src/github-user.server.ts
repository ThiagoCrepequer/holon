import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  githubEmailsSchema,
  githubInstallationsSchema,
  githubMembershipsSchema,
  githubMembershipSchema,
  githubRepositoriesSchema,
  githubRefreshSchema,
  githubUserSchema,
  type GitHubInstallation,
} from "@holon/contracts/dashboard-collaboration";
import {
  createCredentialPersistence,
  type CredentialRecord,
} from "@holon/db/auth-integration/server";
import {
  CollaborationError,
  type InstallationProof,
  type RecipientProof,
} from "@holon/db/identity/server";
import {
  symmetricDecrypt,
  symmetricEncrypt,
  type SecretConfig,
} from "better-auth/crypto";

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10",
  "User-Agent": "holon-dashboard",
});
async function checked<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof CollaborationError) throw error;
    throw new CollaborationError("unavailable");
  }
}

export interface GitHubUserService {
  status(
    actor: AdmittedUser,
  ): Promise<{ status: "connected" | "refreshing" | "reconnect_required" }>;
  verifyInstallation(
    actor: AdmittedUser,
    installationId: number,
  ): Promise<InstallationProof>;
  repositories(
    actor: AdmittedUser,
    installationId: number,
  ): Promise<{
    accountId: string;
    generation: number;
    repositoryIds: number[];
  }>;
  recipient(actor: AdmittedUser): Promise<RecipientProof>;
  identity(
    actor: AdmittedUser,
  ): Promise<{ accountId: string; generation: number }>;
}
export function createGitHubUserService(options: {
  database: D1Database;
  clientId: string;
  clientSecret: string;
  appId: number;
  cryptoKey: string | SecretConfig;
  fetch?: typeof fetch;
}): GitHubUserService {
  const store = createCredentialPersistence(options.database);
  const transport = options.fetch ?? fetch;
  async function access(
    actor: AdmittedUser,
  ): Promise<{ record: CredentialRecord; token: string }> {
    let record = await store.read(actor);
    if (record.state === "reconnect_required")
      throw new CollaborationError("reconnect_required");
    if (record.state === "refreshing")
      throw new CollaborationError("unavailable");
    if (!record.accessToken) {
      await store.disconnect(actor, record);
      throw new CollaborationError("reconnect_required");
    }
    if (
      record.accessExpiresAt !== null &&
      record.accessExpiresAt <= Date.now() + 5000
    ) {
      if (
        !record.refreshToken ||
        record.refreshExpiresAt === null ||
        record.refreshExpiresAt <= Date.now()
      ) {
        await store.disconnect(actor, record);
        throw new CollaborationError("reconnect_required");
      }
      const claim = await store.claim(actor, record);
      if (!claim) {
        record = await store.read(actor);
        if (
          record.state === "ready" &&
          record.accessToken &&
          (record.accessExpiresAt === null ||
            record.accessExpiresAt > Date.now() + 5000)
        )
          return { record, token: await decrypt(record.accessToken) };
        throw new CollaborationError(
          record.state === "reconnect_required"
            ? "reconnect_required"
            : "unavailable",
        );
      }
      try {
        const refresh = await decrypt(record.refreshToken);
        const response = await transport(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              client_id: options.clientId,
              client_secret: options.clientSecret,
              grant_type: "refresh_token",
              refresh_token: refresh,
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok) throw new Error("refresh failed");
        const pair = githubRefreshSchema.parse(await response.json());
        const now = Date.now();
        const saved = await store.complete(actor, claim, {
          accessToken: await symmetricEncrypt({
            key: options.cryptoKey,
            data: pair.access_token,
          }),
          refreshToken: await symmetricEncrypt({
            key: options.cryptoKey,
            data: pair.refresh_token,
          }),
          accessExpiresAt: now + pair.expires_in * 1000,
          refreshExpiresAt: now + pair.refresh_token_expires_in * 1000,
        });
        if (!saved) throw new Error("refresh superseded");
      } catch {
        await store.disconnect(actor, claim);
        throw new CollaborationError("reconnect_required");
      }
      record = await store.read(actor);
    }
    if (!record.accessToken) throw new CollaborationError("reconnect_required");
    try {
      return { record, token: await decrypt(record.accessToken) };
    } catch {
      await store.disconnect(actor, record);
      throw new CollaborationError("reconnect_required");
    }
  }
  function decrypt(value: string) {
    return symmetricDecrypt({ key: options.cryptoKey, data: value });
  }
  async function get(
    actor: AdmittedUser,
    record: CredentialRecord,
    token: string,
    path: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await transport(`https://api.github.com${path}`, {
        headers: headers(token),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new CollaborationError("unavailable");
    }
    if (response.status === 401) {
      await store.disconnect(actor, record);
      throw new CollaborationError("reconnect_required");
    }
    if (!response.ok) throw new CollaborationError("unavailable");
    try {
      return await response.json();
    } catch {
      throw new CollaborationError("unavailable");
    }
  }
  async function installations(
    actor: AdmittedUser,
    record: CredentialRecord,
    token: string,
  ): Promise<GitHubInstallation[]> {
    const all: GitHubInstallation[] = [];
    let expected: number | null = null;
    for (let page = 1; page <= 100; page++) {
      const data = githubInstallationsSchema.parse(
        await get(
          actor,
          record,
          token,
          `/user/installations?per_page=100&page=${page}`,
        ),
      );
      if (expected !== null && expected !== data.total_count)
        throw new CollaborationError("unavailable");
      expected = data.total_count;
      all.push(...data.installations);
      if (all.length === expected) {
        if (new Set(all.map((i) => i.id)).size !== all.length)
          throw new CollaborationError("unavailable");
        return all;
      }
      if (data.installations.length < 100 || all.length > expected)
        throw new CollaborationError("unavailable");
    }
    throw new CollaborationError("unavailable");
  }
  async function activeInstallation(
    actor: AdmittedUser,
    record: CredentialRecord,
    token: string,
    id: number,
  ) {
    const found = (await installations(actor, record, token)).find(
      (i) => i.id === id,
    );
    if (!found || found.app_id !== options.appId || found.suspended_at !== null)
      throw new CollaborationError("denied");
    return found;
  }
  return {
    async status(actor) {
      const row = await store.read(actor);
      const usable =
        row.accessToken &&
        (row.accessExpiresAt === null ||
          row.accessExpiresAt > Date.now() + 5000 ||
          (row.refreshToken &&
            row.refreshExpiresAt !== null &&
            row.refreshExpiresAt > Date.now()));
      return {
        status:
          row.state === "ready" && usable
            ? "connected"
            : row.state === "refreshing"
              ? "refreshing"
              : "reconnect_required",
      };
    },
    async identity(actor) {
      const { record } = await access(actor);
      return { accountId: record.accountId, generation: record.generation };
    },
    async verifyInstallation(actor, id) {
      return checked(async () => {
        const { record, token } = await access(actor);
        const user = githubUserSchema.parse(
          await get(actor, record, token, "/user"),
        );
        if (String(user.id) !== actor.githubAccountId)
          throw new CollaborationError("reconnect_required");
        const installation = await activeInstallation(actor, record, token, id);
        let owner =
          installation.account.type === "User" &&
          String(installation.account.id) === actor.githubAccountId;
        if (installation.account.type === "Organization") {
          for (let page = 1; page <= 100; page++) {
            const memberships = githubMembershipsSchema.parse(
              await get(
                actor,
                record,
                token,
                `/user/memberships/orgs?state=active&per_page=100&page=${page}`,
              ),
            );
            if (
              memberships.some(
                (m) =>
                  m.organization.id === installation.account.id &&
                  m.state === "active" &&
                  m.role === "admin",
              )
            )
              owner = true;
            if (memberships.length < 100) break;
            if (page === 100) throw new CollaborationError("unavailable");
          }
        }
        if (!owner) throw new CollaborationError("denied");
        // Revalidate the installation after completing the paginated membership proof.
        const current = await activeInstallation(actor, record, token, id);
        if (
          current.account.id !== installation.account.id ||
          current.account.type !== installation.account.type
        )
          throw new CollaborationError("denied");
        if (current.account.type === "Organization") {
          const membership = githubMembershipSchema.parse(
            await get(
              actor,
              record,
              token,
              `/user/memberships/orgs/${encodeURIComponent(current.account.login)}`,
            ),
          );
          if (
            membership.organization.id !== current.account.id ||
            membership.state !== "active" ||
            membership.role !== "admin"
          )
            throw new CollaborationError("denied");
        }
        return {
          accountId: record.accountId,
          credentialGeneration: record.generation,
          installationId: id,
          accountOwnerId: installation.account.id,
        };
      });
    },
    async repositories(actor, id) {
      return checked(async () => {
        const { record, token } = await access(actor);
        const subject = githubUserSchema.parse(
          await get(actor, record, token, "/user"),
        );
        if (String(subject.id) !== actor.githubAccountId)
          throw new CollaborationError("reconnect_required");
        await activeInstallation(actor, record, token, id);
        const ids: number[] = [];
        let expected: number | null = null;
        for (let page = 1; page <= 100; page++) {
          const data = githubRepositoriesSchema.parse(
            await get(
              actor,
              record,
              token,
              `/user/installations/${id}/repositories?per_page=100&page=${page}`,
            ),
          );
          if (expected !== null && expected !== data.total_count)
            throw new CollaborationError("unavailable");
          expected = data.total_count;
          ids.push(...data.repositories.map((r) => r.id));
          if (ids.length === expected) {
            if (new Set(ids).size !== ids.length)
              throw new CollaborationError("unavailable");
            return {
              accountId: record.accountId,
              generation: record.generation,
              repositoryIds: ids,
            };
          }
          if (data.repositories.length < 100 || ids.length > expected)
            throw new CollaborationError("unavailable");
        }
        throw new CollaborationError("unavailable");
      });
    },
    async recipient(actor) {
      return checked(async () => {
        const { record, token } = await access(actor);
        const user = githubUserSchema.parse(
          await get(actor, record, token, "/user"),
        );
        if (String(user.id) !== actor.githubAccountId)
          throw new CollaborationError("reconnect_required");
        const emails = githubEmailsSchema.parse(
          await get(actor, record, token, "/user/emails"),
        );
        return {
          accountId: record.accountId,
          generation: record.generation,
          verifiedEmails: emails.filter((e) => e.verified).map((e) => e.email),
        };
      });
    },
  };
}
