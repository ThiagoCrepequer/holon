import { useLingui } from "@lingui/react";
import { useLocation, useRouteLoaderData } from "react-router";

import type { DashboardViewerData } from "../../viewer-data.js";
import { WorkspaceControls } from "../collaboration/public.js";
import { ReviewReturnLink } from "../reviews/public.js";
import { SignIn } from "../sessions/public.js";

export function AccountOverview({ account = false }: { account?: boolean }) {
  const { i18n } = useLingui();
  const location = useLocation();
  const data = useRouteLoaderData<DashboardViewerData>("root");
  const viewer = data?.viewer;
  const admitted = viewer?.status === "authenticated";
  return (
    <main
      className={
        admitted
          ? "grid min-w-0 gap-8"
          : "mx-auto max-w-content px-5 py-12 md:px-12 md:py-24"
      }
    >
      <ReviewReturnLink
        destination={new URLSearchParams(location.search).get("returnTo")}
      />
      <div className={admitted ? "max-w-reading" : "max-w-reading pb-8"}>
        <h1
          className={
            admitted
              ? "text-page leading-title font-semibold tracking-tight wrap-anywhere"
              : "font-editorial text-5xl leading-title md:text-7xl"
          }
        >
          {admitted || account
            ? i18n._({ id: "account.dashboard", message: "Dashboard" })
            : i18n._({
                id: "welcome.heading",
                message: "Your reviews, in context.",
              })}
        </h1>
        {!admitted && (
          <p className="mt-3 text-secondary">
            {i18n._({
              id: "welcome.description",
              message:
                "Understand every change with clarity and the context that matters.",
            })}
          </p>
        )}
      </div>
      {admitted ? (
        <WorkspaceControls />
      ) : viewer?.status !== "disabled" ? (
        <SignIn reconnect={viewer?.status === "disconnected"} />
      ) : null}
    </main>
  );
}
