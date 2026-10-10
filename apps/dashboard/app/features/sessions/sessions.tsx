import { Button } from "@holon/ui/button";
import { useLingui } from "@lingui/react";
import { useEffect, useState } from "react";

import { githubSignIn } from "./session-client.js";

export function SignIn({ reconnect = false }: { reconnect?: boolean }) {
  const { i18n } = useLingui();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    setInteractive(true);
  }, []);
  return (
    <div>
      {reconnect && (
        <p role="status">
          {i18n._({
            id: "session.expired",
            message: "Your session is unavailable. Sign in again to continue.",
          })}
        </p>
      )}
      <Button
        busy={busy}
        disabled={!interactive}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setFailed(false);
          const url = await githubSignIn(window.location.href);
          if (url) {
            window.location.assign(url);
            return;
          }
          setBusy(false);
          setFailed(true);
        }}
      >
        {i18n._({ id: "session.signin", message: "Sign in with GitHub" })}
      </Button>
      {failed && (
        <p role="alert">
          {i18n._({
            id: "session.failed",
            message: "Unable to confirm the session. Please try again.",
          })}
        </p>
      )}
    </div>
  );
}
