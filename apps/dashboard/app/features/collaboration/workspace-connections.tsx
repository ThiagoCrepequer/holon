import { Badge } from "@holon/ui/badge";
import { Button } from "@holon/ui/button";
import { Card, CardHeader, CardTitle } from "@holon/ui/card";
import { Icon } from "@holon/ui/icons";
import { InputField } from "@holon/ui/input-field";
import { useLingui } from "@lingui/react";
import { useState } from "react";
import { Link, useLocation } from "react-router";

import { workspaceMessages } from "./workspace-messages.js";
import { useWorkspace } from "./workspace-state.js";

export function WorkspaceConnections() {
  const { i18n } = useLingui();
  const labels = workspaceMessages(i18n);
  const state = useWorkspace();
  const location = useLocation();
  const theme = new URLSearchParams(location.search).get("theme");
  const [installation, setInstallation] = useState("");
  const busy = state.status === "loading";
  const workspace = state.workspace;
  if (!workspace) return null;
  const title = i18n._({
    id: "repositories.title",
    message: "Authorized repositories",
  });
  return (
    <Card id="repositories" aria-label={labels.github}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="text-secondary">
            <Icon name="github" />
          </span>
          <CardTitle>{labels.github}</CardTitle>
        </div>
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => void state.loadConnections()}
        >
          {labels.refresh}
        </Button>
      </CardHeader>
      <p className="mb-4 text-small text-secondary">
        {i18n._({
          id: "connections.hint",
          message: "Confirm your GitHub access to open a repository’s reviews.",
        })}
      </p>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void state.loadRepositories()}
      >
        <Icon name="repository" />
        {i18n._({ id: "repositories.load", message: "Choose a repository" })}
      </Button>
      {state.repositories && (
        <ul aria-label={title} className="mt-4 divide-y divide-border">
          {state.repositories.map((repo) => (
            <li
              key={`${repo.installationId}:${repo.repositoryId}`}
              className="py-4"
            >
              <Link
                className="flex items-center justify-between gap-3 rounded-md text-small font-semibold"
                to={`/reviews?${new URLSearchParams({ workspace: workspace.workspace.id, installation: String(repo.installationId), repository: String(repo.repositoryId), order: "activity", lang: i18n.locale, ...(theme === "dark" ? { theme } : {}) })}`}
              >
                <span>
                  {repo.fullName}
                  <span className="mt-1 block text-caption font-normal text-secondary">
                    {i18n._({
                      id: "repositories.open",
                      message: "Open reviews",
                    })}
                  </span>
                </span>
                <Icon name="chevronRight" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {state.repositories?.length === 0 && (
        <p className="mt-4 rounded-md bg-muted p-4 text-small text-secondary">
          {i18n._({
            id: "repositories.empty",
            message:
              "No currently authorized repositories. Check the connection and your GitHub access.",
          })}
        </p>
      )}
      {state.connections && (
        <ul className="mt-4 grid gap-3">
          {state.connections.map((connection) => (
            <li
              key={connection.installationId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
            >
              <span className="font-mono text-caption text-secondary">
                GitHub #{connection.installationId}
              </span>
              <Badge
                tone={connection.state === "active" ? "success" : "warning"}
              >
                {labels[connection.state]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {workspace.role === "owner" && (
        <details
          open={!state.repositories?.length}
          className="mt-6 border-t border-border pt-4"
        >
          <summary className="cursor-pointer text-small font-semibold text-link">
            {i18n._({
              id: "connections.manage",
              message: "Manage GitHub installation",
            })}
          </summary>
          <div className="mt-4 grid max-w-reading gap-4">
            <InputField
              id="installation-id"
              label={labels.installation}
              hint={i18n._({
                id: "connections.installationHint",
                message:
                  "Find this number in the URL of the installation’s GitHub settings.",
              })}
              type="number"
              min="1"
              value={installation}
              disabled={busy}
              onChange={(event) => setInstallation(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void state.verify("link", installation)}
                disabled={busy}
              >
                {labels.link}
              </Button>
              <Button
                variant="quiet"
                onClick={() => void state.verify("unlink", installation)}
                disabled={busy}
              >
                {labels.unlink}
              </Button>
            </div>
          </div>
        </details>
      )}
    </Card>
  );
}
