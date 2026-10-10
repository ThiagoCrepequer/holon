import type { ReauthAction } from "@holon/contracts/dashboard";
import { Button } from "@holon/ui/button";
import { Card, CardHeader, CardTitle } from "@holon/ui/card";
import { useLingui } from "@lingui/react";

import { useWorkspace } from "./workspace-state.js";

export function WorkspaceMembers() {
  const { i18n } = useLingui();
  const state = useWorkspace();
  const page = state.members;
  const busy = state.status === "loading";
  const actionLabel = (action: ReauthAction) =>
    ({
      promote: i18n._({ id: "members.promote", message: "Promote to owner" }),
      demote: i18n._({ id: "members.demote", message: "Make member" }),
      remove: i18n._({ id: "members.remove", message: "Remove member" }),
      leave: i18n._({ id: "members.leave", message: "Leave workspace" }),
    })[action];
  return (
    <Card
      aria-label={i18n._({
        id: "members.title",
        message: "Members and owners",
      })}
    >
      <CardHeader>
        <CardTitle>
          {i18n._({ id: "members.title", message: "Members and owners" })}
        </CardTitle>
      </CardHeader>
      <Button
        variant="quiet"
        disabled={busy}
        onClick={() => void state.loadMembers()}
      >
        {i18n._({ id: "members.refresh", message: "Refresh members" })}
      </Button>
      {page && (
        <>
          <p className="my-4 text-small text-secondary">
            {i18n._({
              id: "members.reauth",
              message:
                "Role changes and leaving require confirmation with the same GitHub identity.",
            })}
          </p>
          <ul className="mt-4 divide-y divide-border">
            {page.members.map((member) => (
              <li
                key={member.userId}
                className="grid gap-3 py-4"
                data-member-id={member.userId}
              >
                <span>
                  {member.name} ·{" "}
                  {member.role === "owner"
                    ? i18n._({ id: "members.owner", message: "Owner" })
                    : i18n._({ id: "members.member", message: "Member" })}
                </span>
                {page.actorRole === "owner" && (
                  <div className="flex flex-wrap gap-2">
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
                            (member.role === "owner" && page.ownerCount === 1)
                          }
                          aria-label={`${actionLabel(action)}: ${member.name}`}
                          onClick={() =>
                            void state.verifyMember(action, member.userId)
                          }
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
              disabled={busy}
              onClick={() => void state.loadMembers(page.nextCursor)}
            >
              {i18n._({ id: "members.next", message: "Next members" })}
            </Button>
          )}
          <p className="my-4 text-small text-secondary">
            {i18n._({
              id: "members.lastOwner",
              message:
                "A team needs an owner. Promote another member before the last owner leaves.",
            })}
          </p>
          <Button
            variant="danger"
            disabled={
              busy || (page.actorRole === "owner" && page.ownerCount === 1)
            }
            onClick={() => void state.verifyMember("leave", state.userId)}
          >
            {actionLabel("leave")}
          </Button>
        </>
      )}
    </Card>
  );
}
