import {
  dashboardIdSchema,
  reauthReceiptSchema,
} from "@holon/contracts/dashboard";
import {
  authorizedRepositoryListSchema,
  connectionCommandSchema,
  connectionDtoSchema,
  connectionListSchema,
  connectionReauthSchema,
  createInvitationSchema,
  emptyCollaborationCommandSchema,
  githubConnectionStatusSchema,
  invitationDtoSchema,
  invitationListSchema,
} from "@holon/contracts/dashboard-collaboration";
import type { Hono, Context } from "hono";

import type {
  ApiEnv,
  MutationAdmission,
  SessionAdmission,
} from "./http-context.server.js";
import { HttpBoundaryError } from "./http-security.server.js";
import { consumeReadRateLimit } from "./http-services.server.js";
function readPathId(value: unknown): string {
  const parsed = dashboardIdSchema.safeParse(value);
  if (!parsed.success) throw new HttpBoundaryError("invalid_request", 400);
  return parsed.data;
}
function collaboration(c: Context<{ Bindings: ApiEnv }>) {
  if (!c.env.services.collaboration)
    throw new HttpBoundaryError("unavailable", 503);
  return c.env.services.collaboration;
}

interface Boundary {
  requireAdmittedSession: SessionAdmission;
  requireAdmittedMutation: MutationAdmission;
  respondWithCookies: (data: unknown, cookies: string[]) => Response;
}
export function registerCollaborationRoutes(
  api: Hono<{ Bindings: ApiEnv }>,
  boundary: Boundary,
) {
  const {
    requireAdmittedSession,
    requireAdmittedMutation,
    respondWithCookies,
  } = boundary;
  api.get("/api/github/status", async (c) => {
    await consumeReadRateLimit(c.req.raw, c.env.services, "/api/github/status");
    const { user } = await requireAdmittedSession(
      c.req.raw,
      c.env.services,
      c.env.sessionCookies,
    );
    return respondWithCookies(
      githubConnectionStatusSchema.parse(
        await collaboration(c).connectionStatus(user),
      ),
      c.env.sessionCookies,
    );
  });
  api.post("/api/github/reauth", async (c) => {
    const { user, payload } = await requireAdmittedMutation(
      c.req.raw,
      c.env.origin,
      c.env.services,
      c.env.sessionCookies,
      connectionReauthSchema,
    );
    return respondWithCookies(
      reauthReceiptSchema.parse(
        await collaboration(c).createConnectionReauth(
          user,
          payload.workspaceId,
          payload.installationId,
          payload.action,
        ),
      ),
      c.env.sessionCookies,
    );
  });
  api.get("/api/workspaces/:id/github", async (c) => {
    await consumeReadRateLimit(c.req.raw, c.env.services, "/api/github");
    const { user } = await requireAdmittedSession(
      c.req.raw,
      c.env.services,
      c.env.sessionCookies,
    );
    return respondWithCookies(
      connectionListSchema.parse(
        await collaboration(c).listConnections(
          user,
          readPathId(c.req.param("id")),
        ),
      ),
      c.env.sessionCookies,
    );
  });
  api.get("/api/workspaces/:id/github/repositories", async (c) => {
    await consumeReadRateLimit(c.req.raw, c.env.services, "/api/github");
    const { user } = await requireAdmittedSession(
      c.req.raw,
      c.env.services,
      c.env.sessionCookies,
    );
    const scope = await collaboration(c).authorizeReviews(
      user,
      readPathId(c.req.param("id")),
    );
    return respondWithCookies(
      authorizedRepositoryListSchema.parse({
        repositories: scope.repositories,
      }),
      c.env.sessionCookies,
    );
  });
  for (const action of ["link", "unlink"] as const)
    api.post(`/api/workspaces/:id/github/${action}`, async (c) => {
      const { user, payload } = await requireAdmittedMutation(
        c.req.raw,
        c.env.origin,
        c.env.services,
        c.env.sessionCookies,
        connectionCommandSchema,
      );
      const workspaceId = readPathId(c.req.param("id"));
      const result =
        action === "link"
          ? connectionDtoSchema.parse(
              await collaboration(c).linkInstallation(
                user,
                workspaceId,
                payload,
              ),
            )
          : await collaboration(c).unlinkInstallation(
              user,
              workspaceId,
              payload,
            );
      return respondWithCookies(result, c.env.sessionCookies);
    });
  api.get("/api/workspaces/:id/invitations", async (c) => {
    await consumeReadRateLimit(c.req.raw, c.env.services, "/api/invitations");
    const { user } = await requireAdmittedSession(
      c.req.raw,
      c.env.services,
      c.env.sessionCookies,
    );
    return respondWithCookies(
      invitationListSchema.parse(
        await collaboration(c).listInvitations(
          user,
          readPathId(c.req.param("id")),
        ),
      ),
      c.env.sessionCookies,
    );
  });
  api.post("/api/workspaces/:id/invitations", async (c) => {
    const { user, payload } = await requireAdmittedMutation(
      c.req.raw,
      c.env.origin,
      c.env.services,
      c.env.sessionCookies,
      createInvitationSchema,
    );
    return respondWithCookies(
      invitationDtoSchema.parse(
        await collaboration(c).createInvitation(
          user,
          readPathId(c.req.param("id")),
          payload,
        ),
      ),
      c.env.sessionCookies,
    );
  });
  api.get("/api/invitations/:id", (c) =>
    c.json({ status: "authentication_required" }),
  );
  api.post("/api/invitations/:id/accept", async (c) => {
    const { user } = await requireAdmittedMutation(
      c.req.raw,
      c.env.origin,
      c.env.services,
      c.env.sessionCookies,
      emptyCollaborationCommandSchema,
    );
    return respondWithCookies(
      await collaboration(c).acceptInvitation(
        user,
        readPathId(c.req.param("id")),
      ),
      c.env.sessionCookies,
    );
  });
  api.post(
    "/api/workspaces/:id/invitations/:invitationId/cancel",
    async (c) => {
      const { user } = await requireAdmittedMutation(
        c.req.raw,
        c.env.origin,
        c.env.services,
        c.env.sessionCookies,
        emptyCollaborationCommandSchema,
      );
      return respondWithCookies(
        invitationDtoSchema.parse(
          await collaboration(c).cancelInvitation(
            user,
            readPathId(c.req.param("id")),
            readPathId(c.req.param("invitationId")),
          ),
        ),
        c.env.sessionCookies,
      );
    },
  );
}
