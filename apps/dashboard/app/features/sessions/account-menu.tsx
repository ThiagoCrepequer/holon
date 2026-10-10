import { Button } from "@holon/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@holon/ui/dropdown-menu";
import { Icon } from "@holon/ui/icons";
import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { revokeDevice } from "./session-client.js";

export function AccountMenu({
  name,
  sessionId,
  csrf,
  interactive,
  trigger,
  onPreferences,
  onSessionLost,
}: {
  name: string;
  interactive: boolean;
  sessionId: string;
  csrf: string;
  trigger: RefObject<HTMLButtonElement | null>;
  onPreferences: () => void;
  onSessionLost: (sessionId: string) => void;
}) {
  const { i18n } = useLingui();
  const controller = useRef<AbortController | null>(null);
  const openingPreferences = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  async function signOut() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setFailed(false);
    const result = await revokeDevice(
      "/api/auth/sign-out",
      csrf,
      request.signal,
    );
    if (request.signal.aborted) return;
    controller.current = null;
    setBusy(false);
    if (result === "done" || result === "lost") onSessionLost(sessionId);
    else setFailed(true);
  }
  return (
    <div className="mt-6 border-t border-border pt-4 md:mt-auto">
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) openingPreferences.current = false;
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              variant="quiet"
              className="w-full justify-start px-2 text-left"
            />
          }
          aria-label={i18n._({ id: "account.menu", message: "Account menu" })}
          disabled={!interactive || busy}
        >
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-selected text-small font-semibold text-selected-foreground"
            aria-hidden="true"
          >
            {Array.from(name)[0]}
          </span>
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <Icon name="chevronDown" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          finalFocus={() => !openingPreferences.current}
        >
          <DropdownMenuItem
            onClick={() => {
              openingPreferences.current = true;
              onPreferences();
            }}
          >
            <Icon name="settings" />
            {i18n._({ id: "preferences.title", message: "Preferences" })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void signOut()}>
            <Icon name="signout" />
            {i18n._({ id: "session.signout", message: "Sign out" })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {failed && (
        <p role="alert" className="mt-2 text-small text-warning-foreground">
          {i18n._({
            id: "session.failed",
            message: "Unable to confirm the session. Please try again.",
          })}
        </p>
      )}
    </div>
  );
}
