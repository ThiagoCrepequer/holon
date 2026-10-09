import {
  workspaceDtoSchema,
  workspaceRoleSchema,
} from "@holon/contracts/dashboard";
import { connectionCommandSchema } from "@holon/contracts/dashboard-collaboration";
import { Button } from "@holon/ui/button";
import { SelectField } from "@holon/ui/select-field";
import { useLingui } from "@lingui/react";
import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import {
  collaborationRequest,
  connectionOAuth,
  reconnectGitHub,
} from "./collaboration-client.js";
import { WorkspaceConnections } from "./workspace-connections.js";
import { WorkspaceInvitations } from "./workspace-invitations.js";
import { workspaceMessages } from "./workspace-messages.js";
import type { Workspace } from "./workspace-types.js";
type Props = {
  sessionId: string;
  csrf: string;
  onSessionLost: (id: string) => void;
};
export function WorkspaceControls({ sessionId, csrf, onSessionLost }: Props) {
  const { i18n } = useLingui();
  const [parameters, setParameters] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState("idle");
  const [open, setOpen] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [teamName, setTeamName] = useState("");
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const teamOperation = useRef<string | null>(null);
  useLayoutEffect(() => {
    setInteractive(true);
    return () => {
      generation.current++;
      pending.current?.abort();
    };
  }, []);
  function clearScope() {
    setWorkspace(null);
  }
  async function run(
    path: string,
    body: unknown,
    onReady: (data: unknown) => void,
    global = false,
  ) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setStatus("loading");
    const result = await collaborationRequest(
      path,
      controller.signal,
      body === undefined ? undefined : { csrf, body },
    );
    if (controller.signal.aborted || current !== generation.current) return;
    pending.current = null;
    if (result.status === "ready") {
      try {
        onReady(result.data);
        if (current === generation.current) setStatus("ready");
      } catch {
        setStatus("unavailable");
      }
      return;
    }
    if (result.status === "denied") {
      clearScope();
      if (global) onSessionLost(sessionId);
    }
    setStatus(result.status);
  }
  async function loadWorkspaces() {
    setOpen(true);
    clearScope();
    await run(
      "/api/workspaces",
      undefined,
      (data) => {
        if (
          !data ||
          typeof data !== "object" ||
          !("workspaces" in data) ||
          !Array.isArray(data.workspaces)
        )
          throw new Error();
        setWorkspaces(
          data.workspaces.map((row) => {
            if (!row || typeof row !== "object") throw new Error();
            return {
              workspace: workspaceDtoSchema.parse(row.workspace),
              role: workspaceRoleSchema.parse(row.role),
            };
          }),
        );
      },
      true,
    );
  }
  const labels = workspaceMessages(i18n);
  const messages: Record<string, string> = {
    loading: labels.loading,
    ready: labels.ready,
    unavailable: labels.unavailable,
    denied: labels.denied,
    reconnect: labels.reconnect,
    unconfirmed: labels.unconfirmed,
    rate_limited: labels.rate,
  };
  async function verify(action: "link" | "unlink", installation: string) {
    const id = Number(installation);
    if (!workspace || !Number.isSafeInteger(id) || id <= 0) {
      setStatus("unavailable");
      return;
    }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setStatus("loading");
    const url = await connectionOAuth(
      workspace.workspace.id,
      id,
      action,
      csrf,
      controller.signal,
    );
    if (controller.signal.aborted || generation.current !== current) return;
    pending.current = null;
    if (url) window.location.assign(url);
    else setStatus("unavailable");
  }
  const confirmation = connectionCommandSchema.safeParse({
    installationId: Number(parameters.get("installation")),
    reauthIntentId: parameters.get("reauth"),
  });
  const confirmationAction = parameters.get("connectionAction");
  const confirmationWorkspace = parameters.get("workspace");
  return (
    <section className="holon-collaboration" aria-label={labels.title}>
      <Button
        variant="quiet"
        disabled={!interactive}
        onClick={() => void loadWorkspaces()}
        busy={status === "loading"}
      >
        {labels.load}
      </Button>
      {confirmation.success &&
        confirmationWorkspace &&
        (confirmationAction === "link" || confirmationAction === "unlink") && (
          <Button
            disabled={!interactive}
            onClick={() =>
              void run(
                `/api/workspaces/${encodeURIComponent(confirmationWorkspace)}/github/${confirmationAction}`,
                confirmation.data,
                () => {
                  setParameters({});
                  void loadWorkspaces();
                },
              )
            }
          >
            {labels.confirm}
          </Button>
        )}
      {open && (
        <>
          <h2>{labels.title}</h2>
          <SelectField
            label={labels.workspace}
            value={workspace?.workspace.id ?? ""}
            options={[
              { value: "", label: labels.choose },
              ...workspaces.map((w) => ({
                value: w.workspace.id,
                label: w.workspace.name,
              })),
            ]}
            onChange={(event) => {
              generation.current++;
              pending.current?.abort();
              clearScope();
              setWorkspace(
                workspaces.find((w) => w.workspace.id === event.target.value) ??
                  null,
              );
              setStatus("idle");
            }}
          />
          <Button
            variant="quiet"
            onClick={() =>
              void run(
                "/api/workspaces/personal",
                {},
                () => void loadWorkspaces(),
              )
            }
          >
            {labels.personal}
          </Button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              teamOperation.current ??= crypto.randomUUID();
              void run(
                "/api/workspaces/team",
                { name: teamName, operationId: teamOperation.current },
                () => {
                  teamOperation.current = null;
                  setTeamName("");
                  void loadWorkspaces();
                },
              );
            }}
          >
            <div className="holon-field">
              <label htmlFor="team-name">{labels.team}</label>
              <input
                id="team-name"
                value={teamName}
                maxLength={128}
                required
                onChange={(event) => {
                  teamOperation.current = null;
                  setTeamName(event.target.value);
                }}
              />
            </div>
            <Button type="submit" disabled={status === "loading"}>
              {labels.createTeam}
            </Button>
          </form>
          {workspace && (
            <>
              <WorkspaceConnections
                key={workspace.workspace.id}
                workspace={workspace}
                labels={labels}
                busy={status === "loading"}
                run={run}
                verify={verify}
              />
              {workspace.workspace.type === "team" &&
                workspace.role === "owner" && (
                  <WorkspaceInvitations
                    key={workspace.workspace.id}
                    workspaceId={workspace.workspace.id}
                    labels={labels}
                    busy={status === "loading"}
                    run={run}
                    onInvalid={() => setStatus("unavailable")}
                  />
                )}
            </>
          )}
        </>
      )}
      {status === "reconnect" && (
        <Button
          onClick={async () => {
            const controller = new AbortController();
            pending.current = controller;
            const url = await reconnectGitHub(controller.signal);
            if (!controller.signal.aborted && url) window.location.assign(url);
          }}
        >
          {labels.reconnectAction}
        </Button>
      )}
      {messages[status] && (
        <p
          role={
            ["denied", "unavailable", "unconfirmed", "reconnect"].includes(
              status,
            )
              ? "alert"
              : "status"
          }
        >
          {messages[status]}
        </p>
      )}
    </section>
  );
}
