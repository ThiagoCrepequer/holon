import {
  createTeamWorkspaceInputSchema,
  dashboardIdSchema,
  type DashboardLocale,
  type ReauthAction,
  type WorkspaceMemberPage,
} from "@holon/contracts/dashboard";
import {
  createInvitationSchema,
  type ConnectionDto,
  type InvitationDto,
  type CreateInvitation,
  type AuthorizedRepositoryList,
} from "@holon/contracts/dashboard-collaboration";
import {
  createContext,
  use,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router";

import { connectionOAuth, reconnectGitHub } from "./collaboration-client.js";
import { workspaceData, type WorkspaceResult } from "./workspace-data.js";
import type { Workspace, WorkspaceRequestStatus } from "./workspace-types.js";

type Props = {
  sessionId: string;
  userId: string;
  csrf: string;
  onSessionLost: (id: string) => void;
};
function useWorkspaceState({ sessionId, userId, csrf, onSessionLost }: Props) {
  const [parameters, setParameters] = useSearchParams();
  const urlWorkspaceId = parameters.get("workspace");
  const previousScope = useRef(urlWorkspaceId);
  const location = useLocation();
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [open, setOpen] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [status, setStatus] = useState<WorkspaceRequestStatus>("idle");
  const [connections, setConnections] = useState<ConnectionDto[] | null>(null);
  const [repositories, setRepositories] = useState<
    AuthorizedRepositoryList["repositories"] | null
  >(null);
  const [members, setMembers] = useState<WorkspaceMemberPage | null>(null);
  const [invitations, setInvitations] = useState<InvitationDto[] | null>(null);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const teamIntent = useRef<{ operationId: string; name: string } | null>(null);
  const invitationIntents = useRef(new Map<string, CreateInvitation>());
  const data = workspaceData(csrf);
  useLayoutEffect(() => {
    setInteractive(true);
    return () => {
      generation.current++;
      pending.current?.abort();
    };
  }, []);
  function clearSnapshots() {
    setConnections(null);
    setRepositories(null);
    setMembers(null);
    setInvitations(null);
  }
  useLayoutEffect(() => {
    if (previousScope.current === urlWorkspaceId) return;
    previousScope.current = urlWorkspaceId;
    generation.current++;
    pending.current?.abort();
    pending.current = null;
    clearSnapshots();
    setWorkspace(
      workspaces.find((row) => row.workspace.id === urlWorkspaceId) ?? null,
    );
    setStatus("idle");
  }, [urlWorkspaceId, workspaces]);
  function select(id: string, updateURL = true, rows = workspaces) {
    generation.current++;
    pending.current?.abort();
    pending.current = null;
    clearSnapshots();
    setWorkspace(rows.find((row) => row.workspace.id === id) ?? null);
    setStatus("idle");
    if (updateURL) {
      const next = new URLSearchParams(parameters);
      if (id) next.set("workspace", id);
      else next.delete("workspace");
      for (const key of [
        "installation",
        "repository",
        "cursor",
        "listCursor",
        "pullRequest",
        "search",
        "status",
        "returnTo",
        "connectionAction",
        "memberAction",
        "targetUser",
        "reauth",
      ])
        next.delete(key);
      if (location.pathname.startsWith("/reviews"))
        void navigate(`/account?${next}`);
      else setParameters(next);
    }
  }
  async function run<T>(
    effect: (signal: AbortSignal) => Promise<WorkspaceResult<T>>,
    apply: (value: T) => void,
    mutation = false,
    global = false,
  ) {
    if (mutation && pending.current && !pending.current.signal.aborted) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setStatus("loading");
    const result = await effect(controller.signal);
    if (controller.signal.aborted || generation.current !== current) return;
    pending.current = null;
    if (result.status === "ready") {
      setStatus("ready");
      apply(result.data);
      return;
    }
    if (result.status === "denied" || result.status === "reconnect") {
      clearSnapshots();
      if (result.status === "denied") setWorkspace(null);
      if (global) {
        setWorkspaces([]);
        onSessionLost(sessionId);
      }
    }
    if (!mutation) clearSnapshots();
    if (global) setWorkspaces([]);
    setStatus(result.status);
  }
  async function loadWorkspaces(createdId?: string) {
    setOpen(true);
    clearSnapshots();
    setWorkspace(null);
    await run(
      data.workspaces,
      (rows) => {
        setWorkspaces(rows);
        if (createdId) select(createdId, true, rows);
        else
          setWorkspace(
            rows.find(
              (row) => row.workspace.id === parameters.get("workspace"),
            ) ?? null,
          );
      },
      false,
      true,
    );
  }
  const selected =
    workspace?.workspace.id === urlWorkspaceId ? workspace : null;
  const id = selected?.workspace.id;
  const scoped = <T,>(
    effect: (id: string, signal: AbortSignal) => Promise<WorkspaceResult<T>>,
    apply: (value: T) => void,
    mutation = false,
  ) =>
    id
      ? run((signal) => effect(id, signal), apply, mutation)
      : Promise.resolve();
  async function createTeam(name: string) {
    if (!teamIntent.current) {
      const parsed = createTeamWorkspaceInputSchema.safeParse({
        name,
        operationId: crypto.randomUUID(),
      });
      if (!parsed.success) {
        setStatus("unavailable");
        return false;
      }
      teamIntent.current = parsed.data;
    }
    const captured = teamIntent.current;
    let confirmed = false;
    await run(
      (signal) => data.createTeam(captured, signal),
      (created) => {
        confirmed = true;
        teamIntent.current = null;
        void loadWorkspaces(created.id);
      },
      true,
    );
    return confirmed;
  }
  async function invite(email: string, locale: DashboardLocale) {
    if (!id) return false;
    let intent = invitationIntents.current.get(id);
    if (!intent) {
      const parsed = createInvitationSchema.safeParse({
        email,
        locale,
        operationId: crypto.randomUUID(),
      });
      if (!parsed.success) {
        setStatus("unavailable");
        return false;
      }
      intent = parsed.data;
      invitationIntents.current.set(id, intent);
    }
    const captured = intent;
    let confirmed = false;
    await scoped(
      (workspaceId, signal) => data.invite(workspaceId, captured, signal),
      (invitation) => {
        confirmed = true;
        invitationIntents.current.delete(id);
        setInvitations((previous) => [
          ...(previous ?? []).filter((row) => row.id !== invitation.id),
          invitation,
        ]);
      },
      true,
    );
    return confirmed;
  }
  async function verify(action: "link" | "unlink", installation: string) {
    const installationId = Number(installation);
    if (!id || !Number.isSafeInteger(installationId) || installationId <= 0) {
      setStatus("unavailable");
      return;
    }
    clearSnapshots();
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setStatus("loading");
    const url = await connectionOAuth(
      id,
      installationId,
      action,
      csrf,
      controller.signal,
    );
    if (controller.signal.aborted || generation.current !== current) return;
    pending.current = null;
    if (url) window.location.assign(url);
    else setStatus("unavailable");
  }
  async function reconnect() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setStatus("loading");
    const url = await reconnectGitHub(controller.signal);
    if (controller.signal.aborted || generation.current !== current) return;
    pending.current = null;
    if (url) window.location.assign(url);
    else setStatus("reconnect");
  }
  function removeProof(keys: string[]) {
    const next = new URLSearchParams(parameters);
    keys.forEach((key) => next.delete(key));
    setParameters(next);
    void loadWorkspaces();
  }
  return {
    sessionId,
    userId,
    csrf,
    workspaces,
    workspace: selected,
    hasScope: dashboardIdSchema.safeParse(urlWorkspaceId).success,
    open,
    interactive,
    status,
    connections: selected ? connections : null,
    repositories: selected ? repositories : null,
    members: selected ? members : null,
    invitations: selected ? invitations : null,
    teamIntent: teamIntent.current,
    invitationIntent: id ? invitationIntents.current.get(id) : undefined,
    select,
    loadWorkspaces,
    createTeam,
    invite,
    verify,
    reconnect,
    createPersonal: async () => {
      let confirmed = false;
      await run(
        data.createPersonal,
        (created) => {
          confirmed = true;
          void loadWorkspaces(created.id);
        },
        true,
      );
      return confirmed;
    },
    loadConnections: () => {
      setConnections(null);
      return scoped(data.connections, setConnections);
    },
    loadRepositories: () => {
      setRepositories(null);
      return scoped(data.repositories, (result) =>
        setRepositories(result.repositories),
      );
    },
    loadMembers: (cursor: string | null = null) => {
      setMembers(null);
      return scoped(
        (workspaceId, signal) => data.members(workspaceId, cursor, signal),
        setMembers,
      );
    },
    loadInvitations: () => {
      setInvitations(null);
      return scoped(data.invitations, setInvitations);
    },
    cancelInvitation: (invitationId: string) =>
      scoped(
        (workspaceId, signal) => data.cancel(workspaceId, invitationId, signal),
        (result) =>
          setInvitations((previous) =>
            (previous ?? []).map((row) =>
              row.id === result.id ? result : row,
            ),
          ),
        true,
      ),
    verifyMember: (action: ReauthAction, target: string) =>
      scoped(
        (workspaceId, signal) =>
          data.memberVerification(workspaceId, action, target, signal),
        (url) => window.location.assign(url),
        true,
      ),
    confirmConnection: (
      workspaceId: string,
      action: "link" | "unlink",
      input: unknown,
    ) =>
      run(
        (signal) => data.confirmConnection(workspaceId, action, input, signal),
        () => removeProof(["connectionAction", "installation", "reauth"]),
        true,
      ),
    confirmMember: (
      workspaceId: string,
      action: "promote" | "demote" | "remove" | "leave",
      proof: string,
      target: string,
    ) =>
      run(
        (signal) =>
          data.confirmMember(workspaceId, action, proof, target, signal),
        () => removeProof(["memberAction", "targetUser", "reauth"]),
        true,
      ),
  };
}
const WorkspaceContext = createContext<ReturnType<
  typeof useWorkspaceState
> | null>(null);
export function WorkspaceProvider({
  children,
  ...props
}: Props & { children: ReactNode }) {
  return (
    <WorkspaceContext value={useWorkspaceState(props)}>
      {children}
    </WorkspaceContext>
  );
}
export function useWorkspace() {
  const value = use(WorkspaceContext);
  if (!value) throw new Error("workspace_provider_required");
  return value;
}
