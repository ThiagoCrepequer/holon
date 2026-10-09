import { BrandMark } from "@holon/ui/brand";
import { Button } from "@holon/ui/button";
import { Dialog } from "@holon/ui/dialog";
import { Icon } from "@holon/ui/icons";
import { useLingui } from "@lingui/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useRevalidator,
  useRouteLoaderData,
} from "react-router";

import type { DashboardViewerData } from "../../viewer-data.js";
import { WorkspaceControls } from "../collaboration/public.js";
import { PreferencesForm } from "../preferences/public.js";
import { ReviewReturnLink } from "../reviews/public.js";
import { SessionControls, SignIn } from "../sessions/public.js";
export function AccountOverview({ account = false }: { account?: boolean }) {
  const { i18n } = useLingui();
  const location = useLocation();
  const data = useRouteLoaderData<DashboardViewerData>("root")!;
  const { revalidate } = useRevalidator();
  const currentSession = useRef<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  useLayoutEffect(() => {
    setInteractive(true);
    currentSession.current =
      data.viewer.status === "authenticated" ? data.viewer.sessionId : null;
  }, [data.viewer]);
  const [open, setOpen] = useState(false);
  const preferencesTrigger = useRef<HTMLButtonElement>(null);
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
    <div className={`holon-welcome${admitted ? " holon-account" : ""}`}>
      <header>
        <div className="holon-wordmark">
          <BrandMark decorative />
          holon
        </div>
        <Link to={`${account ? "/" : "/account"}?lang=${data.locale}`}>
          {account
            ? i18n._({ id: "account.home", message: "Home" })
            : i18n._({
                id: "account.title",
                message: "Account and workspaces",
              })}
        </Link>
        <Button
          variant="quiet"
          aria-label={preferences}
          onClick={() => setOpen(true)}
          ref={preferencesTrigger}
          disabled={!interactive}
        >
          <Icon name="settings" />
        </Button>
      </header>
      <main>
        <ReviewReturnLink
          destination={new URLSearchParams(location.search).get("returnTo")}
        />
        <h1>
          {account
            ? i18n._({ id: "account.title", message: "Account and workspaces" })
            : i18n._({
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
          <p className="holon-hint">
            {i18n._({
              id: "account.steps",
              message:
                "Choose a workspace, connect your GitHub installation, then open an authorized repository to read reviews.",
            })}
          </p>
        )}
        {admitted && (
          <WorkspaceControls
            key={`collaboration-${admitted.sessionId}`}
            sessionId={admitted.sessionId}
            userId={admitted.user.id}
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
        returnFocusRef={preferencesTrigger}
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
