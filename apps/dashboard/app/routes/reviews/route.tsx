import {
  reviewListResponseSchema,
  reviewDetailResponseSchema,
  privateReviewPageSchema,
  privateReviewDetailSchema,
} from "@holon/contracts/dashboard-reviews";
import { useLingui } from "@lingui/react";
import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import {
  Link,
  useLoaderData,
  useLocation,
  useRouteLoaderData,
  useNavigate,
  data as routeData,
} from "react-router";

import {
  createReviewQueryClient,
  loadReviews,
  reviewIdentity,
} from "../../features/reviews/public.js";
import { reviewStateMessages } from "../../features/reviews/public.js";
import {
  reviewQueryKey,
  reviewParameters,
  reviewScope,
  type ReviewResource,
} from "../../features/reviews/public.js";
import { viewerServicesContext } from "../../request-context.js";
import type { loader as rootLoader } from "../../root.js";
import { errorResponse } from "../../server/http-security.server.js";
import { readPrivateReviews } from "../../server/private-reviews.server.js";
import type { Route } from "./+types/route";
function resource(url: URL): ReviewResource {
  return url.pathname.endsWith("/detail") ? "detail" : "list";
}
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url),
    kind = resource(url),
    cookies: string[] = [];
  let raw;
  try {
    raw = await readPrivateReviews(
      request,
      context.get(viewerServicesContext),
      kind,
      cookies,
    );
  } catch (error) {
    const response = errorResponse(error);
    for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
    throw response;
  }
  const result =
    kind === "list"
      ? reviewListResponseSchema.parse(raw)
      : reviewDetailResponseSchema.parse(raw);
  const client = createReviewQueryClient();
  client.setQueryData(
    reviewQueryKey(
      reviewIdentity(result.identity.userId, result.identity.sessionId),
      url,
      kind,
    ),
    result.result,
    {
      updatedAt: Date.parse(
        kind === "list"
          ? reviewListResponseSchema.parse(result).result.observedAt
          : reviewDetailResponseSchema.parse(result).result.review.observedAt,
      ),
    },
  );
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return routeData({ dehydrated: dehydrate(client) }, { headers });
}
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await loadReviews(
    new URL(request.url),
    resource(new URL(request.url)),
    request.signal,
  );
  return { dehydrated: { queries: [], mutations: [] } };
}
export default function Reviews() {
  const loaded = useLoaderData<typeof loader>();
  const [consumed, setConsumed] = useState(false);
  useEffect(() => setConsumed(true), []);
  return (
    <HydrationBoundary state={consumed ? undefined : loaded.dehydrated}>
      <ReviewDataset />
    </HydrationBoundary>
  );
}
function ReviewDataset() {
  const navigate = useNavigate();
  const root = useRouteLoaderData<typeof rootLoader>("root"),
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
  const [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false);
  useEffect(() => {
    setRefreshing(false);
    setDenied(false);
    setError(false);
  }, [location.key]);
  useEffect(() => {
    const lost = () => setDenied(true),
      scopeLost = (event: Event) => {
        if ((event as CustomEvent).detail === reviewScope(url)) lost();
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
    if (pr) next.searchParams.set("pullRequest", String(pr));
    return next.pathname + next.search;
  };
  const refresh = async () => {
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
      <Link to="/">holon</Link>
      <h1>{i18n._({ id: "reviews.title", message: "Reviews" })}</h1>
      <p>
        {i18n._({
          id: "reviews.observation",
          message: "Current observation. Refresh to see recent activity.",
        })}
      </p>
      <button
        type="button"
        disabled={!interactive || refreshing || denied}
        onClick={() => void refresh()}
      >
        {i18n._({ id: "reviews.refresh", message: "Refresh" })}
      </button>
      {denied || error || (!page && !detail) ? (
        <p role="alert">
          {i18n._({
            id: "reviews.unavailable",
            message:
              "Review data unavailable. Check your access and try again.",
          })}
        </p>
      ) : null}
      {page ? (
        <>
          <form
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
            <button type="submit" disabled={!interactive}>
              {i18n._({ id: "reviews.apply", message: "Apply filters" })}
            </button>
          </form>
          <p>
            {page.total} {i18n._({ id: "reviews.results", message: "results" })}
          </p>
          <ul>
            {page.items.map((item) => (
              <li key={item.pullRequestNumber}>
                <Link
                  to={href("/reviews/detail", null, item.pullRequestNumber)}
                >
                  #{item.pullRequestNumber} · {item.title}
                </Link>
                <p>
                  {item.author} · {states[item.state]}
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
          <Link to={href("/reviews")}>
            {i18n._({ id: "reviews.back", message: "Back to reviews" })}
          </Link>
          <h2>
            #{detail.review.pullRequestNumber} · {detail.review.title}
          </h2>
          <p>
            {states[detail.review.state]} · <code>{detail.review.headSha}</code>
          </p>
          <p>{detail.summary}</p>
          <ol>
            {detail.findings.map((finding) => (
              <li key={finding.fingerprint}>
                <strong>
                  {finding.severity} · {finding.location.path}:
                  {finding.location.line}
                </strong>
                <p>{finding.diagnostic}</p>
                {finding.evidence.map((evidence, index) => (
                  <figure key={index}>
                    <figcaption>
                      {evidence.path}:{evidence.startLine} · {evidence.reason}
                    </figcaption>
                    <pre>{evidence.excerpt}</pre>
                  </figure>
                ))}
                {finding.suggestion ? (
                  <pre>
                    {typeof finding.suggestion === "string"
                      ? finding.suggestion
                      : JSON.stringify(finding.suggestion)}
                  </pre>
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
