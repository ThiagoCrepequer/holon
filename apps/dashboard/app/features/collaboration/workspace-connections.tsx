import {
  connectionListSchema,
  type ConnectionDto,
} from "@holon/contracts/dashboard-collaboration";
import { Button } from "@holon/ui/button";
import { useState } from "react";

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
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [installation, setInstallation] = useState("");
  return (
    <>
      <h3>{labels.github}</h3>
      <Button
        variant="quiet"
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
