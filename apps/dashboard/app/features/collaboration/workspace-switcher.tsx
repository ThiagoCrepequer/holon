import { Button } from "@holon/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@holon/ui/dropdown-menu";
import { Icon } from "@holon/ui/icons";
import { InputField } from "@holon/ui/input-field";
import { Sheet } from "@holon/ui/sheet";
import { useLingui } from "@lingui/react";
import { useRef, useState } from "react";

import { workspaceMessages } from "./workspace-messages.js";
import { useWorkspace } from "./workspace-state.js";

export function WorkspaceSwitcher() {
  const { i18n } = useLingui();
  const state = useWorkspace();
  const labels = workspaceMessages(i18n);
  const [sheet, setSheet] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const creating = useRef(false);
  const title = i18n._({
    id: "workspace.create",
    message: "Create a workspace",
  });
  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void state.loadWorkspaces();
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              variant="secondary"
              className="w-full justify-between text-left"
            />
          }
          aria-label={labels.workspace}
          data-workspace-id={state.workspace?.workspace.id ?? ""}
          disabled={!state.interactive}
        >
          <span className="min-w-0 truncate">
            {state.workspace?.workspace.name ??
              (state.hasScope ? labels.workspace : labels.choose)}
          </span>
          <Icon name="chevronDown" />
        </DropdownMenuTrigger>
        <DropdownMenuContent finalFocus={() => !creating.current}>
          {state.status === "loading" && (
            <p className="px-3 py-2 text-small text-secondary" role="status">
              {labels.loading}
            </p>
          )}
          <DropdownMenuRadioGroup
            value={state.workspace?.workspace.id ?? ""}
            onValueChange={(value) => state.select(value)}
          >
            {state.workspaces.map((row) => (
              <DropdownMenuRadioItem
                key={row.workspace.id}
                value={row.workspace.id}
                data-workspace-id={row.workspace.id}
              >
                {row.workspace.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={state.status === "loading"}
            onClick={() => {
              creating.current = true;
              setSheet(true);
            }}
          >
            <Icon name="plus" />
            {title}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Sheet
        open={sheet}
        onOpenChange={(open) => {
          setSheet(open);
          if (!open) creating.current = false;
        }}
        returnFocusRef={trigger}
        title={title}
        description={i18n._({
          id: "workspace.createDescription",
          message:
            "Choose a personal workspace or create a shared workspace for your team.",
        })}
        closeLabel={i18n._({
          id: "workspace.closeCreate",
          message: "Close workspace creation",
        })}
      >
        {sheet && (
          <WorkspaceCreation
            onCreated={() => {
              setSheet(false);
              creating.current = false;
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function WorkspaceCreation({ onCreated }: { onCreated: () => void }) {
  const { i18n } = useLingui();
  const state = useWorkspace();
  const labels = workspaceMessages(i18n);
  const [name, setName] = useState("");
  const busy = state.status === "loading";
  return (
    <div className="grid gap-8">
      {!state.workspaces.some((row) => row.workspace.type === "personal") && (
        <div className="grid gap-4 border-b border-border pb-6">
          <p className="text-small text-secondary">
            {i18n._({
              id: "workspace.personalHint",
              message: "Review your own repositories in a personal workspace.",
            })}
          </p>
          <Button
            variant="secondary"
            busy={busy}
            onClick={async () => {
              if (await state.createPersonal()) onCreated();
            }}
          >
            {labels.personal}
          </Button>
        </div>
      )}
      <form
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await state.createTeam(name)) onCreated();
        }}
      >
        <InputField
          label={labels.team}
          value={state.teamIntent?.name ?? name}
          maxLength={128}
          required
          disabled={busy || state.teamIntent !== null}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" busy={busy}>
          {labels.createTeam}
        </Button>
      </form>
      {((state.teamIntent !== null && !busy) ||
        ["unconfirmed", "unavailable", "denied", "rate_limited"].includes(
          state.status,
        )) && (
        <p role="alert" className="text-small text-warning-foreground">
          {state.teamIntent !== null || state.status === "unconfirmed"
            ? labels.unconfirmed
            : state.status === "rate_limited"
              ? labels.rate
              : labels.unavailable}
        </p>
      )}
    </div>
  );
}
