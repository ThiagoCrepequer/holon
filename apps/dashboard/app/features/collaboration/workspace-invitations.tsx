import { dashboardLocaleSchema } from "@holon/contracts/dashboard";
import { Badge } from "@holon/ui/badge";
import { Button } from "@holon/ui/button";
import { Card, CardHeader, CardTitle } from "@holon/ui/card";
import { Icon } from "@holon/ui/icons";
import { InputField } from "@holon/ui/input-field";
import { useLingui } from "@lingui/react";
import { useState } from "react";

import { workspaceMessages } from "./workspace-messages.js";
import { useWorkspace } from "./workspace-state.js";

export function WorkspaceInvitations() {
  const { i18n } = useLingui();
  const labels = workspaceMessages(i18n);
  const state = useWorkspace();
  const [email, setEmail] = useState("");
  const busy = state.status === "loading";
  return (
    <Card id="invitations" aria-label={labels.invitationTitle}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="text-secondary">
            <Icon name="mail" />
          </span>
          <CardTitle>{labels.invitationTitle}</CardTitle>
        </div>
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => void state.loadInvitations()}
        >
          {labels.list}
        </Button>
      </CardHeader>
      <p className="mb-4 text-small text-secondary">{labels.privacy}</p>
      <form
        className="grid items-end gap-4 sm:grid-cols-[1fr_auto]"
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            await state.invite(email, dashboardLocaleSchema.parse(i18n.locale))
          )
            setEmail("");
        }}
      >
        <InputField
          id="invitation-email"
          label={labels.email}
          type="email"
          autoComplete="off"
          required
          maxLength={254}
          disabled={busy || state.invitationIntent !== undefined}
          value={state.invitationIntent?.email ?? email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" disabled={!state.interactive || busy}>
          {labels.invite}
        </Button>
      </form>
      {state.invitationIntent && (
        <p className="mt-3 text-small text-warning-foreground" role="status">
          {labels.unconfirmed}
        </p>
      )}
      {state.invitations && (
        <ul className="mt-6 divide-y divide-border">
          {state.invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-start justify-between gap-3 py-4"
            >
              <div className="min-w-0 flex-1">
                <a
                  className="font-semibold wrap-anywhere"
                  href={`/invitations/${invitation.id}`}
                >
                  {invitation.recipientEmail}
                </a>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      invitation.state === "accepted"
                        ? "success"
                        : invitation.state === "pending"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {labels[invitation.state]}
                  </Badge>
                  <span className="text-caption text-secondary">
                    {labels[invitation.delivery]}
                  </span>
                </div>
              </div>
              {invitation.state === "pending" && (
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => void state.cancelInvitation(invitation.id)}
                >
                  {labels.cancel}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {state.invitations?.length === 0 && (
        <p className="mt-4 text-small text-secondary">
          {i18n._({
            id: "invitations.empty",
            message: "No invitations in this workspace.",
          })}
        </p>
      )}
      <details className="mt-6 border-t border-border pt-4">
        <summary className="cursor-pointer text-small font-semibold text-link">
          {i18n._({
            id: "invitations.deliveryHelp",
            message: "How invitation delivery works",
          })}
        </summary>
        <div className="mt-3 grid gap-3 text-small text-secondary">
          <p>{labels.notice}</p>
          <p>{labels.duplicateNotice}</p>
        </div>
      </details>
    </Card>
  );
}
