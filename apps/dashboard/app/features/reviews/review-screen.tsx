import {
  privateReviewPageSchema,
  privateReviewDetailSchema,
} from "@holon/contracts/dashboard-reviews";
import { Button } from "@holon/ui/button";
import { useLingui } from "@lingui/react";
import {
  HydrationBoundary,
  useQuery,
  type DehydratedState,
} from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import {
  Link,
  useLocation,
  useRouteLoaderData,
  useNavigate,
  useNavigation,
} from "react-router";

import {
  reviewQueryKey,
  reviewParameters,
  reviewScope,
  reviewResource as resource,
} from "../../review-parameters.js";
import type { DashboardViewerData } from "../../viewer-data.js";
import { loadReviews, reviewIdentity } from "./review-client.js";
import { ReviewCode } from "./review-code.js";
import { ReviewMarkdown } from "./review-markdown.js";
import { reviewStateMessages } from "./review-messages.js";
import { ReviewRecovery } from "./review-recovery.js";
let continuity: {
  identity: string;
  url: string;
  id: string;
  scroll: number;
} | null = null;
export function ReviewScreen({ dehydrated }: { dehydrated: DehydratedState }) {
  const [consumed, setConsumed] = useState(false);
  useEffect(() => setConsumed(true), []);
  return (
    <HydrationBoundary state={consumed ? undefined : dehydrated}>
      <ReviewDataset />
    </HydrationBoundary>
  );
}
function ReviewDataset() {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const root = useRouteLoaderData<DashboardViewerData>("root"),
    location = useLocation(),
    { i18n } = useLingui();
  const states = reviewStateMessages(i18n);
  const viewer = root?.viewer;
  const identity =
    viewer?.status === "authenticated"
      ? reviewIdentity(viewer.user.id, viewer.sessionId)
      : "anonymous";
  const url = new URL(
      location.pathname + location.search,
      "https://dashboard.invalid",
    ),
    kind = resource(url);
  const query = useQuery({
    queryKey: reviewQueryKey(identity, url, kind),
    enabled: false,
  });
  const refreshController = useRef<AbortController | null>(null);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  useEffect(
    () => () => {
      refreshController.current?.abort();
    },
    [location.key],
  );
  const [denialStatus, setDenialStatus] = useState(403);
  const [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false);
  useEffect(() => {
    setRefreshing(false);
    setDenied(false);
    setError(false);
  }, [location.key]);
  useEffect(() => {
    const lost = () => {
        setDenialStatus(401);
        setDenied(true);
      },
      scopeLost = (event: Event) => {
        if ((event as CustomEvent).detail === reviewScope(url)) {
          setDenialStatus(403);
          setDenied(true);
        }
      };
    window.addEventListener("holon:reviews-session-lost", lost);
    window.addEventListener("holon:reviews-scope-lost", scopeLost);
    return () => {
      window.removeEventListener("holon:reviews-session-lost", lost);
      window.removeEventListener("holon:reviews-scope-lost", scopeLost);
    };
  }, [location.pathname, location.search]);
  const parameters = reviewParameters(url, kind);
  const href = (path: string, cursor: string | null = null, pr?: number) => {
    const next = new URL(url);
    next.pathname = path;
    if (cursor) next.searchParams.set("cursor", cursor);
    else next.searchParams.delete("cursor");
    if (pr) {
      next.searchParams.set("pullRequest", String(pr));
      if (url.searchParams.get("cursor"))
        next.searchParams.set("listCursor", url.searchParams.get("cursor")!);
    }
    if (path === "/reviews") {
      next.searchParams.delete("pullRequest");
      if (kind === "detail" && url.searchParams.get("listCursor"))
        next.searchParams.set("cursor", url.searchParams.get("listCursor")!);
      next.searchParams.delete("listCursor");
    }
    return next.pathname + next.search;
  };
  const refresh = async () => {
    if (kind === "list" && url.searchParams.has("cursor")) {
      const next = new URL(url);
      next.searchParams.delete("cursor");
      await navigate(next.pathname + next.search);
      return;
    }
    const controller = new AbortController();
    refreshController.current?.abort();
    refreshController.current = controller;
    setRefreshing(true);
    setError(false);
    try {
      await loadReviews(url, kind, controller.signal);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (
        !controller.signal.aborted &&
        refreshController.current === controller
      )
        setRefreshing(false);
    }
  };
  const returnToList = () => {
    void navigate(href("/reviews"), { preventScrollReset: true });
  };
  useEffect(() => {
    if (kind !== "detail") return undefined;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        returnToList();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [location.key]);
  useEffect(() => {
    if (
      kind === "list" &&
      continuity?.identity === identity &&
      continuity.url === location.pathname + location.search
    ) {
      document.getElementById(continuity.id)?.focus({ preventScroll: true });
      window.scrollTo(0, continuity.scroll);
    }
  }, [location.key, kind]);
  useEffect(() => {
    if (kind === "detail")
      document.getElementById("review-detail-title")?.focus();
  }, [location.key, kind]);
  const page =
    kind === "list" && query.data && !denied && !error
      ? privateReviewPageSchema.parse(query.data)
      : null;
  const detail =
    kind === "detail" && query.data && !denied && !error
      ? privateReviewDetailSchema.parse(query.data)
      : null;
  return (
    <main className="holon-welcome holon-reviews">
      <header>
        <Link to="/">holon</Link>
        <Link
          to={`/account?lang=${root?.locale ?? "en"}&workspace=${parameters.workspaceId}&returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        >
          {i18n._({ id: "account.title", message: "Account and workspaces" })}
        </Link>
      </header>
      <h1>{i18n._({ id: "reviews.title", message: "Reviews" })}</h1>
      <p>
        {i18n._({
          id: "reviews.observation",
          message:
            "The projection may lag the core. Refresh confirms access and reads the latest available observation.",
        })}
      </p>
      <Button
        variant="secondary"
        disabled={!interactive || refreshing || denied}
        onClick={() => void refresh()}
      >
        {i18n._({ id: "reviews.refresh", message: "Refresh" })}
      </Button>
      {navigation.state !== "idle" || refreshing ? (
        <p role="status">
          {i18n._({
            id: "reviews.loading",
            message: "Confirming current review access…",
          })}
        </p>
      ) : null}
      {page || detail ? (
        <p className="holon-hint">
          {i18n._({ id: "reviews.observedAt", message: "Observed at" })}{" "}
          <time dateTime={page?.observedAt ?? detail!.review.observedAt}>
            {new Intl.DateTimeFormat(root?.locale ?? "en", {
              dateStyle: "medium",
              timeStyle: "medium",
              timeZone:
                viewer?.status === "authenticated"
                  ? (viewer.preferences.timezone ?? "UTC")
                  : "UTC",
            }).format(new Date(page?.observedAt ?? detail!.review.observedAt))}
          </time>
        </p>
      ) : null}
      {denied || error || (!page && !detail) ? (
        <ReviewRecovery status={denied ? denialStatus : 503} />
      ) : null}
      {page ? (
        <>
          <form
            key={location.search}
            onSubmit={(event) => {
              event.preventDefault();
              const next = new URL(url);
              const value = new FormData(event.currentTarget).get("search");
              next.searchParams.set(
                "search",
                typeof value === "string" ? value : "",
              );
              next.searchParams.delete("cursor");
              const status = new FormData(event.currentTarget).get("status");
              if (typeof status === "string" && status)
                next.searchParams.set("status", status);
              else next.searchParams.delete("status");
              next.searchParams.set("order", "activity");
              void navigate(next.pathname + next.search);
            }}
          >
            <label>
              {i18n._({
                id: "reviews.search",
                message: "Search title or PR number",
              })}
              <input
                disabled={!interactive}
                name="search"
                maxLength={200}
                defaultValue={"search" in parameters ? parameters.search : ""}
              />
            </label>
            <label>
              {i18n._({ id: "reviews.status", message: "Review status" })}
              <select
                name="status"
                disabled={!interactive}
                defaultValue={
                  "status" in parameters ? (parameters.status ?? "") : ""
                }
              >
                <option value="">
                  {i18n._({ id: "reviews.all", message: "All states" })}
                </option>
                {Object.entries(states).map(([state, label]) => (
                  <option key={state} value={state}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {i18n._({ id: "reviews.order", message: "Order" })}
              <select
                name="order"
                disabled={!interactive}
                defaultValue="activity"
              >
                <option value="activity">
                  {i18n._({
                    id: "reviews.activityOrder",
                    message: "Latest activity first",
                  })}
                </option>
              </select>
            </label>
            <Button type="submit" disabled={!interactive}>
              {i18n._({ id: "reviews.apply", message: "Apply filters" })}
            </Button>
          </form>
          <p>
            {page.total} {i18n._({ id: "reviews.results", message: "results" })}
          </p>
          <ul>
            {page.items.map((item) => (
              <li key={item.pullRequestNumber}>
                <Link
                  id={`review-${item.pullRequestNumber}`}
                  onClick={() => {
                    continuity = {
                      identity,
                      url: location.pathname + location.search,
                      id: `review-${item.pullRequestNumber}`,
                      scroll: window.scrollY,
                    };
                  }}
                  to={href("/reviews/detail", null, item.pullRequestNumber)}
                >
                  #{item.pullRequestNumber} · {item.title}
                </Link>
                <p>
                  {item.author} · {states[item.state]}
                </p>
                <p className="holon-hint">
                  {i18n._({
                    id: "reviews.snapshotAt",
                    message: "Snapshot observed at",
                  })}{" "}
                  <time dateTime={item.observedAt}>
                    {new Intl.DateTimeFormat(root?.locale ?? "en", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: root?.timezone ?? "UTC",
                    }).format(new Date(item.observedAt))}
                  </time>
                </p>
              </li>
            ))}
          </ul>
          {!page.items.length ? (
            <p>
              {i18n._({
                id: "reviews.empty",
                message: "No reviews match these filters.",
              })}
            </p>
          ) : null}
          {page.nextCursor ? (
            <Link to={href("/reviews", page.nextCursor)}>
              {i18n._({ id: "reviews.next", message: "Next page" })}
            </Link>
          ) : null}
        </>
      ) : null}
      {detail ? (
        <>
          <Link
            to={href("/reviews")}
            onClick={(event) => {
              event.preventDefault();
              returnToList();
            }}
          >
            {i18n._({ id: "reviews.back", message: "Back to reviews" })}
          </Link>
          <h2 tabIndex={-1} id="review-detail-title">
            #{detail.review.pullRequestNumber} · {detail.review.title}
          </h2>
          <p>
            {states[detail.review.state]} · <code>{detail.review.headSha}</code>
          </p>
          {detail.summary && (
            <section
              className="holon-panel"
              aria-label={i18n._({ id: "reviews.summary", message: "Summary" })}
            >
              <ReviewMarkdown>{detail.summary}</ReviewMarkdown>
            </section>
          )}
          <p>
            {detail.totalFindings}{" "}
            {i18n._({ id: "reviews.findings", message: "findings" })}
          </p>
          <ol>
            {detail.findings.map((finding) => (
              <li
                id={`finding-${finding.fingerprint}`}
                key={finding.fingerprint}
              >
                <strong>
                  {
                    {
                      critical: i18n._({
                        id: "severity.critical",
                        message: "Critical",
                      }),
                      high: i18n._({ id: "severity.high", message: "High" }),
                      medium: i18n._({
                        id: "severity.medium",
                        message: "Medium",
                      }),
                      low: i18n._({ id: "severity.low", message: "Low" }),
                    }[finding.severity]
                  }{" "}
                  · {finding.location.path}:{finding.location.line}
                </strong>
                <p>
                  {
                    {
                      new: i18n._({ id: "finding.new", message: "New" }),
                      persistent: i18n._({
                        id: "finding.persistent",
                        message: "Persistent",
                      }),
                      resolved: i18n._({
                        id: "finding.resolved",
                        message: "Resolved",
                      }),
                      obsolete: i18n._({
                        id: "finding.obsolete",
                        message: "Obsolete",
                      }),
                      reintroduced: i18n._({
                        id: "finding.reintroduced",
                        message: "Reintroduced",
                      }),
                      dismissed: i18n._({
                        id: "finding.dismissed",
                        message: "Dismissed",
                      }),
                    }[finding.status]
                  }
                </p>
                <ReviewMarkdown>{finding.diagnostic}</ReviewMarkdown>
                {finding.evidence.map((evidence, index) => (
                  <figure key={index}>
                    <figcaption>
                      {evidence.path}:{evidence.startLine} · {evidence.reason}
                    </figcaption>
                    <ReviewCode>{evidence.excerpt}</ReviewCode>
                  </figure>
                ))}
                {finding.suggestion ? (
                  <ReviewCode>
                    {typeof finding.suggestion === "string"
                      ? finding.suggestion
                      : JSON.stringify(finding.suggestion)}
                  </ReviewCode>
                ) : null}
              </li>
            ))}
          </ol>
          {detail.nextCursor ? (
            <Link to={href("/reviews/detail", detail.nextCursor)}>
              {i18n._({ id: "reviews.nextFindings", message: "More findings" })}
            </Link>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
