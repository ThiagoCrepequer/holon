import { Button } from "@holon/ui/button";
import { useLingui } from "@lingui/react";
import { useLayoutEffect, useRef, useState } from "react";

import { collaborationRequest } from "./collaboration-client.js";
export function InvitationControls({ id, csrf }: { id: string; csrf: string }) {
  const { i18n } = useLingui();
  const [status, setStatus] = useState("idle");
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  return (
    <>
      <Button
        disabled={status === "loading" || status === "accepted"}
        busy={status === "loading"}
        onClick={async () => {
          if (pending.current) return;
          const controller = new AbortController();
          pending.current = controller;
          setStatus("loading");
          const result = await collaborationRequest(
            `/api/invitations/${encodeURIComponent(id)}/accept`,
            controller.signal,
            { csrf, body: {} },
          );
          if (controller.signal.aborted) return;
          pending.current = null;
          if (
            result.status === "ready" &&
            result.data &&
            typeof result.data === "object" &&
            "status" in result.data &&
            result.data.status === "accepted" &&
            "membershipActive" in result.data &&
            typeof result.data.membershipActive === "boolean"
          )
            setStatus(result.data.membershipActive ? "accepted" : "historical");
          else
            setStatus(
              result.status === "ready" ? "unavailable" : result.status,
            );
        }}
      >
        {i18n._({
          id: "invitation.accept",
          message: "Confirm recipient and accept",
        })}
      </Button>
      {status === "accepted" && (
        <p role="status">
          {i18n._({
            id: "invitation.accepted",
            message:
              "Invitation accepted. Repository access is checked separately.",
          })}
        </p>
      )}
      {status === "historical" && (
        <p role="status">
          {i18n._({
            id: "invitation.historical",
            message:
              "This invitation was already accepted. It does not restore a removed membership.",
          })}
        </p>
      )}
      {[
        "denied",
        "reconnect",
        "unavailable",
        "unconfirmed",
        "rate_limited",
      ].includes(status) && (
        <p role="alert">
          {i18n._({
            id: "invitation.failed",
            message:
              "Unable to confirm this invitation. Check your current GitHub account and retry.",
          })}
        </p>
      )}
    </>
  );
}
