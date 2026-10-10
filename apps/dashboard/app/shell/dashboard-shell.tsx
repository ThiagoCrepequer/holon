import { BrandMark } from "@holon/ui/brand";
import { Button } from "@holon/ui/button";
import { Dialog } from "@holon/ui/dialog";
import { Icon } from "@holon/ui/icons";
import { useLingui } from "@lingui/react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, NavLink, useLocation, useRevalidator } from "react-router";

import {
  WorkspaceProvider,
  WorkspaceSwitcher,
} from "../features/collaboration/public.js";
import { PreferencesForm } from "../features/preferences/public.js";
import { AccountMenu, SignIn } from "../features/sessions/public.js";
import type { DashboardViewerData } from "../viewer-data.js";

export function DashboardShell({
  data,
  children,
}: {
  data: DashboardViewerData;
  children: ReactNode;
}) {
  const { i18n } = useLingui();
  const location = useLocation();
  const { revalidate } = useRevalidator();
  const [interactive, setInteractive] = useState(false);
  const [open, setOpen] = useState(false);
  const [deniedSession, setDeniedSession] = useState<string | null>(null);
  const session =
    data.viewer.status === "authenticated" ? data.viewer.sessionId : null;
  const currentSession = useRef(session);
  const preferencesTrigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    currentSession.current = session;
    setInteractive(true);
  }, [session]);
  const onSessionLost = useCallback(
    (id: string) => {
      if (currentSession.current !== id) return;
      setDeniedSession(id);
      setOpen(false);
      void revalidate();
    },
    [revalidate],
  );
  const viewer =
    data.viewer.status === "authenticated" &&
    data.viewer.sessionId !== deniedSession
      ? data.viewer
      : null;
  const title = i18n._({ id: "preferences.title", message: "Preferences" });
  const account = i18n._({
    id: "account.dashboard",
    message: "Dashboard",
  });
  const reviews = i18n._({ id: "reviews.title", message: "Reviews" });
  const parameters = new URLSearchParams({ lang: data.locale });
  const workspace = new URLSearchParams(location.search).get("workspace");
  if (workspace) parameters.set("workspace", workspace);
  if (new URLSearchParams(location.search).get("theme") === "dark")
    parameters.set("theme", "dark");
  if (location.pathname.startsWith("/reviews"))
    parameters.set("returnTo", location.pathname + location.search);
  const accountHref = `/account?${parameters}`;
  const preferences = (
    <Dialog
      returnFocusRef={preferencesTrigger}
      open={open}
      onOpenChange={setOpen}
      title={title}
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
        key={viewer?.sessionId ?? "anonymous"}
        sessionId={viewer?.sessionId ?? null}
        csrf={viewer?.csrf ?? null}
        preferences={viewer?.preferences ?? { locale: null, timezone: null }}
        locale={data.locale}
        onSaved={() => void revalidate()}
        onSessionLost={onSessionLost}
      />
    </Dialog>
  );
  const brand = (
    <Link
      to={`/?${new URLSearchParams({ lang: data.locale, ...(parameters.get("theme") === "dark" ? { theme: "dark" } : {}) })}`}
      aria-label="Holon"
      className="flex w-fit items-center gap-2 text-title-md font-semibold tracking-tight text-foreground"
    >
      <BrandMark decorative />
      <span>holon</span>
    </Link>
  );
  if (!viewer)
    return (
      <div className="min-h-dvh">
        <header className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-4 px-5 py-6 md:px-12">
          {brand}
          <div className="flex flex-wrap items-center gap-3">
            <Link className="text-small font-medium" to={accountHref}>
              {account}
            </Link>
            <Button
              ref={preferencesTrigger}
              variant="quiet"
              disabled={!interactive}
              onClick={() => setOpen(true)}
            >
              <Icon name="settings" />
              {title}
            </Button>
            {preferences}
          </div>
        </header>
        {deniedSession === session && session !== null ? (
          <main className="mx-auto max-w-reading px-5 py-12">
            <SignIn reconnect />
          </main>
        ) : (
          children
        )}
      </div>
    );
  return (
    <WorkspaceProvider
      key={viewer.sessionId}
      sessionId={viewer.sessionId}
      userId={viewer.user.id}
      csrf={viewer.csrf}
      onSessionLost={onSessionLost}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {i18n._({ id: "navigation.skip", message: "Skip to content" })}
      </a>
      <div className="min-h-dvh md:pl-sidebar">
        <aside className="border-b border-border bg-card px-5 py-5 md:fixed md:inset-y-0 md:left-0 md:flex md:w-sidebar md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:px-4 md:py-6">
          <div className="mb-5">{brand}</div>
          <WorkspaceSwitcher />
          <nav
            aria-label={i18n._({
              id: "navigation.main",
              message: "Main navigation",
            })}
            className="mt-6 flex flex-wrap gap-2 md:flex-col"
          >
            <NavLink
              to={accountHref}
              aria-label={account}
              className={({ isActive }) =>
                `flex min-h-control min-w-0 max-w-full items-center gap-3 rounded-md px-3 py-2 text-small font-semibold wrap-anywhere ${isActive || location.pathname === "/" ? "bg-selected text-selected-foreground" : "text-secondary hover:bg-muted"}`
              }
            >
              <Icon name="dashboard" />
              {account}
            </NavLink>
            <Link
              to={
                location.pathname.startsWith("/reviews")
                  ? location.pathname + location.search
                  : `${accountHref}#repositories`
              }
              aria-current={
                location.pathname.startsWith("/reviews") ? "page" : undefined
              }
              className={`flex min-h-control min-w-0 max-w-full items-center gap-3 rounded-md px-3 py-2 text-small font-semibold wrap-anywhere ${location.pathname.startsWith("/reviews") ? "bg-selected text-selected-foreground" : "text-secondary hover:bg-muted"}`}
            >
              <Icon name="reviews" />
              {reviews}
            </Link>
            <Link
              to={`${accountHref}#invitations`}
              className="flex min-h-control min-w-0 max-w-full items-center gap-3 rounded-md px-3 py-2 text-small font-semibold wrap-anywhere text-secondary hover:bg-muted"
            >
              <Icon name="members" />
              {i18n._({
                id: "navigation.team",
                message: "Team and invitations",
              })}
            </Link>
          </nav>
          <AccountMenu
            interactive={interactive}
            key={viewer.sessionId}
            name={viewer.user.name}
            sessionId={viewer.sessionId}
            csrf={viewer.csrf}
            trigger={preferencesTrigger}
            onPreferences={() => setOpen(true)}
            onSessionLost={onSessionLost}
          />
          {preferences}
        </aside>
        {location.pathname.startsWith("/reviews") && (
          <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-4 md:px-8">
            <p className="flex min-w-0 max-w-full flex-wrap items-center gap-3 text-small wrap-anywhere text-secondary">
              <span>Holon</span>
              <Icon name="chevronRight" />
              <span className="font-medium text-foreground">
                {location.pathname.startsWith("/reviews") ? reviews : account}
              </span>
            </p>
          </header>
        )}
        <div
          id="main-content"
          tabIndex={-1}
          className="mx-auto min-w-0 max-w-content wrap-anywhere px-5 py-8 outline-none md:px-8 md:py-10"
        >
          {children}
        </div>
      </div>
    </WorkspaceProvider>
  );
}
