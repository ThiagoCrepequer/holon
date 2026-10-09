import {
  authorizedRepositoryListSchema,
  connectionListSchema,
  type ConnectionDto,
} from "@holon/contracts/dashboard-collaboration";
import { Button } from "@holon/ui/button";
import { useLingui } from "@lingui/react";
import { useState } from "react";
import { Link } from "react-router";

import type { WorkspaceMessages } from "./workspace-messages.js";
import type { Workspace, CollaborationRun } from "./workspace-types.js";
export function WorkspaceConnections({
  workspace,
  labels,
  busy,
  run,
  verify,
}: {
  workspace: Workspace;
  labels: WorkspaceMessages;
  busy: boolean;
  run: CollaborationRun;
  verify: (action: "link" | "unlink", installation: string) => Promise<void>;
}) {
  const { i18n } = useLingui();
  const [repositories, setRepositories] = useState<
    { installationId: number; repositoryId: number }[] | null
  >(null);
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [installation, setInstallation] = useState("");
  return (
    <>
      <h3>{labels.github}</h3>
      <Button
        variant="quiet"
        disabled={busy}
        onClick={() =>
          void run(
            `/api/workspaces/${workspace.workspace.id}/github`,
            undefined,
            (data) => setConnections(connectionListSchema.parse(data)),
          )
        }
      >
        {labels.refresh}
      </Button>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setRepositories(null);
          void run(
            `/api/workspaces/${workspace.workspace.id}/github/repositories`,
            undefined,
            (data) =>
              setRepositories(
                authorizedRepositoryListSchema.parse(data).repositories,
              ),
          );
        }}
      >
        {i18n._({ id: "repositories.load", message: "Choose a repository" })}
      </Button>
      {repositories && (
        <ul
          aria-label={i18n._({
            id: "repositories.title",
            message: "Authorized repositories",
          })}
        >
          {repositories.map((repo) => (
            <li key={`${repo.installationId}:${repo.repositoryId}`}>
              <Link
                to={`/reviews?${new URLSearchParams({ workspace: workspace.workspace.id, installation: String(repo.installationId), repository: String(repo.repositoryId), order: "activity", lang: i18n.locale })}`}
              >
                {i18n._({ id: "repositories.open", message: "Open reviews" })} ·{" "}
                {repo.installationId}/{repo.repositoryId}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {repositories?.length === 0 && (
        <p>
          {i18n._({
            id: "repositories.empty",
            message:
              "No currently authorized repositories. Check the connection and your GitHub access.",
          })}
        </p>
      )}
      <ul>
        {connections.map((c) => (
          <li key={c.installationId}>
            {c.installationId}: {labels[c.state]}
          </li>
        ))}
      </ul>
      {workspace.role === "owner" && (
        <>
          <div className="holon-field">
            <label htmlFor="installation-id">{labels.installation}</label>
            <input
              id="installation-id"
              type="number"
              min="1"
              value={installation}
              onChange={(event) => setInstallation(event.target.value)}
            />
          </div>
          <Button
            onClick={() => void verify("link", installation)}
            disabled={busy}
          >
            {labels.link}
          </Button>
          <Button
            variant="quiet"
            onClick={() => void verify("unlink", installation)}
            disabled={busy}
          >
            {labels.unlink}
          </Button>
        </>
      )}
    </>
  );
}
