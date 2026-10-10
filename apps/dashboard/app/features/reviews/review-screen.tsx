import { Button } from "@holon/ui/button";
import { Icon } from "@holon/ui/icons";
import { useLingui } from "@lingui/react";
import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useRouteLoaderData } from "react-router";

import type { DashboardViewerData } from "../../viewer-data.js";
import { reviewIdentity } from "./review-client.js";
import { useReviewInteraction } from "./review-interaction.js";
import { ReviewRecovery } from "./review-recovery.js";
import { ReviewFilters, ReviewList, ReviewDetail } from "./review-views.js";

export function ReviewScreen({ dehydrated }: { dehydrated: DehydratedState }) {
  const [consumed, setConsumed] = useState(false);
  const location = useLocation();
  const viewer = useRouteLoaderData<DashboardViewerData>("root")?.viewer;
  const identity =
    viewer?.status === "authenticated"
      ? reviewIdentity(viewer.user.id, viewer.sessionId)
      : "anonymous";
  useEffect(() => setConsumed(true), []);
  return (
    <HydrationBoundary state={consumed ? undefined : dehydrated}>
      <ReviewDataset key={`${identity}:${location.key}`} />
    </HydrationBoundary>
  );
}
function ReviewDataset() {
  const { i18n } = useLingui();
  const state = useReviewInteraction();
  const observedAt = state.page?.observedAt ?? state.detail?.review.observedAt;
  return (
    <main className="grid min-w-0 gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-reading">
          <h1 className="text-page leading-title font-semibold tracking-tight">
            {i18n._({ id: "reviews.title", message: "Reviews" })}
          </h1>
          <p className="mt-3 text-small text-secondary">
            {i18n._({
              id: "reviews.observation",
              message:
                "The projection may lag the core. Refresh confirms access and reads the latest available observation.",
            })}
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={
            !state.interactive ||
            state.refreshing ||
            state.denialStatus !== null
          }
          onClick={() => void state.refresh()}
        >
          <Icon name="refresh" />
          {i18n._({ id: "reviews.refresh", message: "Refresh" })}
        </Button>
      </div>
      {state.loading && (
        <p
          role="status"
          className="rounded-md bg-info px-4 py-3 text-small text-info-foreground"
        >
          {i18n._({
            id: "reviews.loading",
            message: "Confirming current review access…",
          })}
        </p>
      )}
      {observedAt && (
        <p className="text-caption text-secondary">
          {i18n._({ id: "reviews.observedAt", message: "Observed at" })}{" "}
          <time dateTime={observedAt}>
            {new Intl.DateTimeFormat(state.root?.locale ?? "en", {
              dateStyle: "medium",
              timeStyle: "medium",
              timeZone: state.root?.timezone ?? "UTC",
            }).format(new Date(observedAt))}
          </time>
        </p>
      )}
      {!state.page && !state.detail && (
        <ReviewRecovery status={state.denialStatus ?? 503} />
      )}
      {state.page && (
        <>
          <ReviewFilters
            parameters={state.parameters}
            interactive={state.interactive}
            apply={state.applyFilters}
          />
          <ReviewList
            page={state.page}
            locale={state.root?.locale ?? "en"}
            timezone={state.root?.timezone ?? "UTC"}
            href={state.href}
            remember={state.remember}
          />
        </>
      )}
      {state.detail && (
        <ReviewDetail
          detail={state.detail}
          href={state.href}
          back={state.returnToList}
        />
      )}
    </main>
  );
}
