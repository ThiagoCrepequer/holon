import { afterEach, expect, it, vi } from "vitest";

import { workspaceData } from "../app/features/collaboration/workspace-data.js";
const signal = new AbortController().signal;
const workspace = { id: "workspace", type: "team", name: "Synthetic team" };
const invitation = {
  id: "invitation",
  workspaceId: "workspace",
  recipientEmail: "person@example.invalid",
  state: "pending",
  expiresAt: "2099-01-01T00:00:00.000Z",
  delivery: "intent_recorded",
};
afterEach(() => vi.unstubAllGlobals());
function response(data: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(data, { status })),
  );
}

it("workspaces never expose partial or malformed memberships", async () => {
  const client = workspaceData("synthetic");
  response({ workspaces: [{ workspace, role: "owner" }] });
  expect(await client.workspaces(signal)).toEqual({
    status: "ready",
    data: [{ workspace, role: "owner" }],
  });
  for (const data of [
    null,
    {},
    { workspaces: [null] },
    { workspaces: [{ workspace, role: "external" }] },
  ]) {
    response(data);
    expect(await client.workspaces(signal)).toEqual({ status: "unavailable" });
  }
  response({}, 401);
  expect(await client.workspaces(signal)).toEqual({ status: "reconnect" });
});
it("commands distinguish a valid creation receipt from a malformed success after a possible effect", async () => {
  const client = workspaceData("synthetic");
  response({
    workspace: { ...workspace, type: "personal" },
    membership: { workspaceId: workspace.id, userId: "actor", role: "owner" },
  });
  expect(await client.createPersonal(signal)).toEqual({
    status: "ready",
    data: { ...workspace, type: "personal" },
  });
  response({
    workspace,
    membership: { workspaceId: workspace.id, userId: "actor", role: "owner" },
  });
  expect(
    await client.createTeam(
      { name: "Synthetic team", operationId: "operation" },
      signal,
    ),
  ).toEqual({ status: "ready", data: workspace });
  for (const raw of [
    null,
    {},
    { workspace: { id: "wrong" } },
    {
      workspace,
      membership: { workspaceId: "foreign", userId: "actor", role: "owner" },
    },
  ]) {
    response(raw);
    expect(
      await client.createTeam(
        { name: "Synthetic team", operationId: "operation" },
        signal,
      ),
    ).toEqual({ status: "unconfirmed" });
  }
});
it("private snapshots admit only validated DTOs and invitations from the requested workspace", async () => {
  const client = workspaceData("synthetic");
  response([{ installationId: 77, state: "active", generation: 1 }]);
  expect((await client.connections("workspace", signal)).status).toBe("ready");
  response({
    repositories: [
      { installationId: 77, repositoryId: 88, fullName: "synthetic/reviews" },
    ],
  });
  expect((await client.repositories("workspace", signal)).status).toBe("ready");
  response({
    members: [{ userId: "member", name: "Synthetic member", role: "member" }],
    actorRole: "owner",
    ownerCount: 1,
    nextCursor: null,
  });
  expect((await client.members("workspace", null, signal)).status).toBe(
    "ready",
  );
  expect(
    (await client.members("workspace", "cursor_safe", signal)).status,
  ).toBe("ready");
  response([invitation]);
  expect(await client.invitations("workspace", signal)).toEqual({
    status: "ready",
    data: [invitation],
  });
  response([{ ...invitation, workspaceId: "foreign" }]);
  expect(await client.invitations("workspace", signal)).toEqual({
    status: "unavailable",
  });
  response(invitation);
  expect(
    (
      await client.invite(
        "workspace",
        {
          operationId: "operation",
          email: invitation.recipientEmail,
          locale: "en",
        },
        signal,
      )
    ).status,
  ).toBe("ready");
  expect((await client.cancel("workspace", "invitation", signal)).status).toBe(
    "ready",
  );
  response({ ...invitation, workspaceId: "foreign" });
  expect(
    await client.invite(
      "workspace",
      {
        operationId: "operation",
        email: invitation.recipientEmail,
        locale: "en",
      },
      signal,
    ),
  ).toEqual({ status: "unconfirmed" });
});
it("membership and connection confirmations require the actual receipt, preserving uncertain effects", async () => {
  const client = workspaceData("synthetic");
  response({ installationId: 77, state: "active", generation: 1 });
  expect(
    (
      await client.confirmConnection(
        "workspace",
        "link",
        { installationId: 77, reauthIntentId: "proof" },
        signal,
      )
    ).status,
  ).toBe("ready");
  response({ unlinked: true });
  expect(
    (
      await client.confirmConnection(
        "workspace",
        "unlink",
        { installationId: 77, reauthIntentId: "proof" },
        signal,
      )
    ).status,
  ).toBe("ready");
  for (const raw of [null, {}, { unlinked: false }]) {
    response(raw);
    expect(
      (
        await client.confirmConnection(
          "workspace",
          "unlink",
          { installationId: 77, reauthIntentId: "proof" },
          signal,
        )
      ).status,
    ).toBe("unconfirmed");
  }
  for (const action of ["promote", "demote"] as const) {
    response({
      workspaceId: "workspace",
      userId: "member",
      role: action === "promote" ? "owner" : "member",
    });
    expect(
      (
        await client.confirmMember(
          "workspace",
          action,
          "proof",
          "member",
          signal,
        )
      ).status,
    ).toBe("ready");
  }
  response({ workspaceId: "foreign", userId: "member", role: "owner" });
  expect(
    (
      await client.confirmMember(
        "workspace",
        "promote",
        "proof",
        "member",
        signal,
      )
    ).status,
  ).toBe("unconfirmed");
  response({ installationId: 99, state: "active", generation: 1 });
  expect(
    (
      await client.confirmConnection(
        "workspace",
        "link",
        { installationId: 77, reauthIntentId: "proof" },
        signal,
      )
    ).status,
  ).toBe("unconfirmed");
  for (const action of ["remove", "leave"] as const) {
    response({ [action === "remove" ? "removed" : "left"]: true });
    expect(
      (
        await client.confirmMember(
          "workspace",
          action,
          "proof",
          "member",
          signal,
        )
      ).status,
    ).toBe("ready");
  }
});
it("member reauthentication preserves scope, target and language and rejects hostile OAuth destinations", async () => {
  const client = workspaceData("synthetic");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        reauthIntentId: "proof",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        url: "https://github.com/login/oauth/authorize?state=synthetic",
      }),
    );
  vi.stubGlobal("window", {
    location: { href: "https://dashboard.example.invalid/account?lang=pt-BR" },
  });
  vi.stubGlobal("fetch", fetch);
  expect(
    (await client.memberVerification("workspace", "promote", "member", signal))
      .status,
  ).toBe("ready");
  expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body)).toMatchObject({
    callbackURL:
      "/account?workspace=workspace&memberAction=promote&targetUser=member&reauth=proof&lang=pt-BR",
  });
  for (const href of [
    "https://dashboard.example.invalid/account",
    "https://dashboard.example.invalid/account?lang=en",
  ]) {
    vi.stubGlobal("window", { location: { href } });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            reauthIntentId: "proof",
            expiresAt: "2099-01-01T00:00:00.000Z",
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ url: "https://evil.example.invalid/steal" }),
        ),
    );
    expect(
      await client.memberVerification("workspace", "remove", "member", signal),
    ).toEqual({ status: "unavailable" });
  }
  vi.unstubAllGlobals();
  response({}, 403);
  expect(
    await client.memberVerification("workspace", "leave", "member", signal),
  ).toEqual({ status: "denied" });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          reauthIntentId: "proof",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          url: "https://github.com/login/oauth/authorize?state=synthetic",
        }),
      ),
  );
  expect(
    (await client.memberVerification("workspace", "leave", "member", signal))
      .status,
  ).toBe("ready");
});
