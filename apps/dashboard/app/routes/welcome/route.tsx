import { BrandMark } from "@holon/ui/brand";
import { Button } from "@holon/ui/button";
import { Dialog } from "@holon/ui/dialog";
import { Icon } from "@holon/ui/icons";
import { useLingui } from "@lingui/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";

import { WorkspaceControls } from "../../features/collaboration/public.js";
import { PreferencesForm } from "../../features/preferences/public.js";
import { SessionControls, SignIn } from "../../features/sessions/public.js";
import type { loader } from "../../root.js";
export function meta() {
  return [{ title: "Holon" }];
}
export default function Welcome() {
  const { i18n } = useLingui();
  const data = useRouteLoaderData<typeof loader>("root")!;
  const { revalidate } = useRevalidator();
  const currentSession = useRef<string | null>(null);
  useLayoutEffect(() => {
    currentSession.current =
      data.viewer.status === "authenticated" ? data.viewer.sessionId : null;
  }, [data.viewer]);
  const [open, setOpen] = useState(false);
  const [deniedSessionId, setDeniedSessionId] = useState<string | null>(null);
  const onSessionLost = useCallback(
    (sessionId: string) => {
      if (sessionId !== currentSession.current) return;
      setDeniedSessionId(sessionId);
      setOpen(false);
      void revalidate();
    },
    [revalidate],
  );
  const viewer = data.viewer;
  const admitted =
    viewer.status === "authenticated" && viewer.sessionId !== deniedSessionId
      ? viewer
      : null;
  const preferences = i18n._({
    id: "preferences.title",
    message: "Preferences",
  });
  return (
    <div className="holon-welcome">
      <header>
        <div className="holon-wordmark">
          <BrandMark decorative />
          holon
        </div>
        <Button
          variant="quiet"
          aria-label={preferences}
          onClick={() => setOpen(true)}
        >
          <Icon name="settings" />
        </Button>
      </header>
      <main>
        <h1>
          {i18n._({
            id: "welcome.heading",
            message: "Your reviews, in context.",
          })}
        </h1>
        <p>
          {i18n._({
            id: "welcome.description",
            message:
              "Understand every change with clarity and the context that matters.",
          })}
        </p>
        {admitted && (
          <WorkspaceControls
            key={`collaboration-${admitted.sessionId}`}
            sessionId={admitted.sessionId}
            csrf={admitted.csrf}
            onSessionLost={onSessionLost}
          />
        )}
        {admitted ? (
          <SessionControls
            key={admitted.sessionId}
            sessionId={admitted.sessionId}
            csrf={admitted.csrf}
            onSessionLost={onSessionLost}
          />
        ) : (
          viewer.status !== "disabled" && (
            <SignIn
              reconnect={
                viewer.status === "disconnected" || deniedSessionId !== null
              }
            />
          )
        )}
      </main>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={preferences}
        description={i18n._({
          id: "preferences.description",
          message: "Choose how you read Holon.",
        })}
        closeLabel={i18n._({
          id: "preferences.close",
          message: "Close preferences",
        })}
      >
        <PreferencesForm
          key={admitted?.sessionId ?? "anonymous"}
          sessionId={admitted?.sessionId ?? null}
          csrf={admitted?.csrf ?? null}
          preferences={
            admitted?.preferences ?? { locale: null, timezone: null }
          }
          locale={data.locale}
          onSaved={() => {
            void revalidate();
          }}
          onSessionLost={onSessionLost}
        />
      </Dialog>
    </div>
  );
}
