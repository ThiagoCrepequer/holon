import {
  dashboardIdSchema,
  reauthActionSchema,
} from "@holon/contracts/dashboard";
import { connectionCommandSchema } from "@holon/contracts/dashboard-collaboration";
import { Button } from "@holon/ui/button";
import { useLingui } from "@lingui/react";
import { useSearchParams } from "react-router";

import { WorkspaceConnections } from "./workspace-connections.js";
import { WorkspaceInvitations } from "./workspace-invitations.js";
import { WorkspaceMembers } from "./workspace-members.js";
import { workspaceMessages } from "./workspace-messages.js";
import { useWorkspace } from "./workspace-state.js";

export function WorkspaceControls() {
  const { i18n } = useLingui();
  const [parameters] = useSearchParams();
  const state = useWorkspace();
  const labels = workspaceMessages(i18n);
  const busy = state.status === "loading";
  const messages = {
    loading: labels.loading,
    ready: labels.ready,
    unavailable: labels.unavailable,
    denied: labels.denied,
    reconnect: labels.reconnect,
    unconfirmed: labels.unconfirmed,
    rate_limited: labels.rate,
  };
  const confirmation = connectionCommandSchema.safeParse({
    installationId: Number(parameters.get("installation")),
    reauthIntentId: parameters.get("reauth"),
  });
  const connectionAction = parameters.get("connectionAction");
  const memberAction = reauthActionSchema.safeParse(
    parameters.get("memberAction"),
  );
  const memberProof = dashboardIdSchema.safeParse(parameters.get("reauth"));
  const memberTarget = dashboardIdSchema.safeParse(
    parameters.get("targetUser"),
  );
  const proofWorkspace = dashboardIdSchema.safeParse(
    parameters.get("workspace"),
  );
  const message = state.status === "idle" ? null : messages[state.status];
  return (
    <section aria-label={labels.title} className="grid min-w-0 gap-6">
      {state.workspace && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-title-md font-semibold tracking-tight">
              {state.workspace.workspace.name}
            </h2>
            <p className="mt-1 text-small text-secondary">
              {state.workspace.role === "owner"
                ? i18n._({ id: "members.owner", message: "Owner" })
                : i18n._({ id: "members.member", message: "Member" })}
            </p>
          </div>
        </div>
      )}
      {proofWorkspace.success &&
        memberAction.success &&
        memberProof.success &&
        memberTarget.success && (
          <Button
            disabled={!state.interactive || busy}
            onClick={() =>
              void state.confirmMember(
                proofWorkspace.data,
                memberAction.data,
                memberProof.data,
                memberTarget.data,
              )
            }
          >
            {i18n._({
              id: "members.confirm",
              message: "Confirm member change",
            })}
          </Button>
        )}
      {proofWorkspace.success &&
        confirmation.success &&
        (connectionAction === "link" || connectionAction === "unlink") && (
          <Button
            disabled={!state.interactive || busy}
            onClick={() =>
              void state.confirmConnection(
                proofWorkspace.data,
                connectionAction,
                confirmation.data,
              )
            }
          >
            {labels.confirm}
          </Button>
        )}
      {message && (
        <p
          className={`${state.status === "ready" ? "sr-only" : "rounded-md border border-border px-4 py-3 text-small"} ${["denied", "unavailable", "unconfirmed", "reconnect"].includes(state.status) ? "bg-warning text-warning-foreground" : "bg-muted text-secondary"}`}
          role={
            ["denied", "unavailable", "unconfirmed", "reconnect"].includes(
              state.status,
            )
              ? "alert"
              : "status"
          }
        >
          {message}
        </p>
      )}
      {state.status === "reconnect" && (
        <Button onClick={() => void state.reconnect()}>
          {labels.reconnectAction}
        </Button>
      )}
      {state.workspace ? (
        <div
          className={`grid min-w-0 items-start gap-6 ${state.workspace.workspace.type === "team" ? "xl:grid-cols-2" : ""}`}
        >
          <WorkspaceConnections />
          {state.workspace.workspace.type === "team" && (
            <div className="grid min-w-0 gap-6">
              <WorkspaceMembers />
              {state.workspace.role === "owner" && (
                <WorkspaceInvitations key={state.workspace.workspace.id} />
              )}
            </div>
          )}
        </div>
      ) : null}
      {!state.workspace && state.status !== "loading" && (
        <div className="max-w-reading border-l-2 border-border pl-5">
          <h2 className="text-title-sm font-semibold">
            {i18n._({
              id: "workspace.start",
              message: "Bring your reviews together",
            })}
          </h2>
          <p className="mt-2 text-secondary">
            {i18n._({
              id: "workspace.startHint",
              message:
                "Choose or create a workspace in the sidebar, then connect GitHub to open your repositories.",
            })}
          </p>
        </div>
      )}
    </section>
  );
}
