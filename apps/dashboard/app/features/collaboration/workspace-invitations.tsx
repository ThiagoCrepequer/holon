import {
  createInvitationSchema,
  invitationDtoSchema,
  invitationListSchema,
  type InvitationDto,
} from "@holon/contracts/dashboard-collaboration";
import { Button } from "@holon/ui/button";
import { useLingui } from "@lingui/react";
import { useRef, useState } from "react";

import type { WorkspaceMessages } from "./workspace-messages.js";
import type { CollaborationRun } from "./workspace-types.js";
export function WorkspaceInvitations({
  workspaceId,
  labels,
  busy,
  run,
  onInvalid,
}: {
  workspaceId: string;
  labels: WorkspaceMessages;
  busy: boolean;
  run: CollaborationRun;
  onInvalid: () => void;
}) {
  const { i18n } = useLingui();
  const [invitations, setInvitations] = useState<InvitationDto[]>([]);
  const [email, setEmail] = useState("");
  const inviteOperation = useRef<string | null>(null);
  return (
    <>
      <h3>{labels.invitationTitle}</h3>
      <p>{labels.notice}</p>
      <p>{labels.privacy}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          inviteOperation.current ??= crypto.randomUUID();
          const input = createInvitationSchema.safeParse({
            operationId: inviteOperation.current,
            email,
            locale: i18n.locale,
          });
          if (!input.success) {
            onInvalid();
            return;
          }
          void run(
            `/api/workspaces/${workspaceId}/invitations`,
            input.data,
            (data) => {
              const invitation = invitationDtoSchema.parse(data);
              setInvitations((previous) => [
                ...previous.filter((i) => i.id !== invitation.id),
                invitation,
              ]);
              inviteOperation.current = null;
              setEmail("");
            },
          );
        }}
      >
        <div className="holon-field">
          <label htmlFor="invitation-email">{labels.email}</label>
          <input
            id="invitation-email"
            type="email"
            autoComplete="off"
            required
            maxLength={254}
            value={email}
            onChange={(event) => {
              inviteOperation.current = null;
              setEmail(event.target.value);
            }}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {labels.invite}
        </Button>
      </form>
      <Button
        variant="quiet"
        onClick={() =>
          void run(
            `/api/workspaces/${workspaceId}/invitations`,
            undefined,
            (data) => setInvitations(invitationListSchema.parse(data)),
          )
        }
      >
        {labels.list}
      </Button>
      <ul>
        {invitations.map((invitation) => (
          <li key={invitation.id}>
            <a href={`/invitations/${invitation.id}`}>{invitation.id}</a> —{" "}
            {labels[invitation.state]}{" "}
            {invitation.state === "pending" && (
              <Button
                variant="quiet"
                onClick={() =>
                  void run(
                    `/api/workspaces/${workspaceId}/invitations/${invitation.id}/cancel`,
                    {},
                    (data) => {
                      const result = invitationDtoSchema.parse(data);
                      setInvitations((previous) =>
                        previous.map((i) => (i.id === result.id ? result : i)),
                      );
                    },
                  )
                }
              >
                {labels.cancel}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
