import {
  workspaceMemberPageSchema,
  reauthReceiptSchema,
  type WorkspaceMemberPage,
  type ReauthAction,
} from "@holon/contracts/dashboard";
import { Button } from "@holon/ui/button";
import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState } from "react";

import { collaborationRequest, oauthRedirect } from "./collaboration-client.js";
import type { CollaborationRun, Workspace } from "./workspace-types.js";

export function WorkspaceMembers({
  workspace,
  userId,
  csrf,
  busy,
  run,
}: {
  workspace: Workspace;
  userId: string;
  csrf: string;
  busy: boolean;
  run: CollaborationRun;
}) {
  const { i18n } = useLingui();
  const [page, setPage] = useState<WorkspaceMemberPage | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const load = (cursor: string | null = null) => {
    setPage(null);
    return run(
      `/api/workspaces/${workspace.workspace.id}/members${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      undefined,
      (data) => setPage(workspaceMemberPageSchema.parse(data)),
    );
  };
  async function verify(action: ReauthAction, targetUserId: string) {
    if (pending.current) return;
    setVerifying(true);
    setError(false);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const proof = await collaborationRequest(
        "/api/auth/reauth/init",
        controller.signal,
        {
          csrf,
          body: {
            workspaceId: workspace.workspace.id,
            action,
            targetUserId,
          },
        },
      );
      if (proof.status !== "ready") throw new Error();
      const receipt = reauthReceiptSchema.parse(proof.data);
      const parameters = new URLSearchParams({
        workspace: workspace.workspace.id,
        memberAction: action,
        targetUser: targetUserId,
        reauth: receipt.reauthIntentId,
      });
      const locale = new URL(window.location.href).searchParams.get("lang");
      if (locale) parameters.set("lang", locale);
      const url = await oauthRedirect(
        {
          provider: "github",
          callbackURL: `/account?${parameters}`,
          reauthIntentId: receipt.reauthIntentId,
          disableRedirect: true,
        },
        controller.signal,
      );
      if (!url) throw new Error();
      if (!controller.signal.aborted) window.location.assign(url);
    } catch {
      if (!controller.signal.aborted) {
        setError(true);
        setVerifying(false);
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }
  const actionLabel = (action: ReauthAction) =>
    ({
      promote: i18n._({ id: "members.promote", message: "Promote to owner" }),
      demote: i18n._({ id: "members.demote", message: "Make member" }),
      remove: i18n._({ id: "members.remove", message: "Remove member" }),
      leave: i18n._({ id: "members.leave", message: "Leave workspace" }),
    })[action];
  return (
    <section
      aria-label={i18n._({
        id: "members.title",
        message: "Members and owners",
      })}
    >
      <h3>{i18n._({ id: "members.title", message: "Members and owners" })}</h3>
      <Button
        variant="quiet"
        disabled={busy || verifying}
        onClick={() => void load()}
      >
        {i18n._({ id: "members.refresh", message: "Refresh members" })}
      </Button>
      {page && (
        <>
          <p>
            {i18n._({
              id: "members.reauth",
              message:
                "Role changes and leaving require confirmation with the same GitHub identity.",
            })}
          </p>
          <ul>
            {page.members.map((member) => (
              <li key={member.userId} data-member-id={member.userId}>
                <span>
                  {member.name} ·{" "}
                  {member.role === "owner"
                    ? i18n._({ id: "members.owner", message: "Owner" })
                    : i18n._({ id: "members.member", message: "Member" })}
                </span>
                {page.actorRole === "owner" && (
                  <div className="holon-actions">
                    {(["promote", "demote", "remove"] as const)
                      .filter(
                        (action) =>
                          action !==
                          (member.role === "owner" ? "promote" : "demote"),
                      )
                      .map((action) => (
                        <Button
                          key={action}
                          variant={action === "remove" ? "danger" : "quiet"}
                          disabled={
                            busy ||
                            verifying ||
                            (member.role === "owner" && page.ownerCount === 1)
                          }
                          aria-label={`${actionLabel(action)}: ${member.name}`}
                          onClick={() => void verify(action, member.userId)}
                        >
                          {actionLabel(action)}
                        </Button>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {page.nextCursor && (
            <Button
              disabled={busy || verifying}
              onClick={() => void load(page.nextCursor)}
            >
              {i18n._({ id: "members.next", message: "Next members" })}
            </Button>
          )}
          <p>
            {i18n._({
              id: "members.lastOwner",
              message:
                "A team needs an owner. Promote another member before the last owner leaves.",
            })}
          </p>
          <Button
            variant="danger"
            disabled={
              busy ||
              verifying ||
              (page.actorRole === "owner" && page.ownerCount === 1)
            }
            onClick={() => void verify("leave", userId)}
          >
            {actionLabel("leave")}
          </Button>
        </>
      )}
      {error && (
        <p role="alert">
          {i18n._({
            id: "members.failed",
            message:
              "Unable to confirm this change. Refresh members and try again.",
          })}
        </p>
      )}
    </section>
  );
}
