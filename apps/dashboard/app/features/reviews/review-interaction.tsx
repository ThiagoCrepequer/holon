import {
  privateReviewPageSchema,
  privateReviewDetailSchema,
} from "@holon/contracts/dashboard-reviews";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import {
  useLocation,
  useRouteLoaderData,
  useNavigate,
  useNavigation,
} from "react-router";

import {
  reviewQueryKey,
  reviewParameters,
  reviewScope,
  reviewResource,
} from "../../review-parameters.js";
import type { DashboardViewerData } from "../../viewer-data.js";
import { loadReviews, reviewIdentity } from "./review-client.js";

let continuity: {
  identity: string;
  url: string;
  id: string;
  scroll: number;
} | null = null;

/** Owns one manual dataset intention and its navigation/focus continuity. Query remains the sole data owner. */
export function useReviewInteraction() {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const root = useRouteLoaderData<DashboardViewerData>("root");
  const location = useLocation();
  const viewer = root?.viewer;
  const identity =
    viewer?.status === "authenticated"
      ? reviewIdentity(viewer.user.id, viewer.sessionId)
      : "anonymous";
  const url = new URL(
    location.pathname + location.search,
    "https://dashboard.invalid",
  );
  const kind = reviewResource(url);
  const scope = reviewScope(url);
  const query = useQuery({
    queryKey: reviewQueryKey(identity, url, kind),
    enabled: false,
  });
  const controller = useRef<AbortController | null>(null);
  const [interactive, setInteractive] = useState(false);
  const [denialStatus, setDenialStatus] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    setInteractive(true);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    const lost = () => setDenialStatus(401);
    const scopeLost = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === scope)
        setDenialStatus(403);
    };
    window.addEventListener("holon:reviews-session-lost", lost);
    window.addEventListener("holon:reviews-scope-lost", scopeLost);
    return () => {
      window.removeEventListener("holon:reviews-session-lost", lost);
      window.removeEventListener("holon:reviews-scope-lost", scopeLost);
    };
  }, [scope]);
  const href = (path: string, cursor: string | null = null, pr?: number) => {
    const next = new URL(url);
    next.pathname = path;
    if (cursor) next.searchParams.set("cursor", cursor);
    else next.searchParams.delete("cursor");
    if (pr) {
      next.searchParams.set("pullRequest", String(pr));
      const listCursor = url.searchParams.get("cursor");
      if (listCursor) next.searchParams.set("listCursor", listCursor);
    }
    if (path === "/reviews") {
      next.searchParams.delete("pullRequest");
      const listCursor = url.searchParams.get("listCursor");
      if (kind === "detail" && listCursor)
        next.searchParams.set("cursor", listCursor);
      next.searchParams.delete("listCursor");
    }
    return next.pathname + next.search;
  };
  const returnToList = () => {
    void navigate(href("/reviews"), { preventScrollReset: true });
  };
  useEffect(() => {
    if (kind === "detail") {
      document.getElementById("review-detail-title")?.focus();
      const escape = (event: KeyboardEvent) => {
        if (document.querySelector("dialog[open]")) return;
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          returnToList();
        }
      };
      window.addEventListener("keydown", escape);
      return () => window.removeEventListener("keydown", escape);
    }
    if (
      continuity?.identity === identity &&
      continuity.url === location.pathname + location.search
    ) {
      document.getElementById(continuity.id)?.focus({ preventScroll: true });
      window.scrollTo(0, continuity.scroll);
    }
    return undefined;
  }, [kind, identity, location.key]);
  async function refresh() {
    if (kind === "list" && url.searchParams.has("cursor")) {
      const next = new URL(url);
      next.searchParams.delete("cursor");
      await navigate(next.pathname + next.search);
      return;
    }
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    setRefreshing(true);
    setError(false);
    try {
      await loadReviews(url, kind, request.signal);
    } catch {
      if (!request.signal.aborted) setError(true);
    } finally {
      if (!request.signal.aborted && controller.current === request)
        setRefreshing(false);
    }
  }
  function applyFilters(form: HTMLFormElement) {
    const next = new URL(url);
    const fields = new FormData(form);
    const search = fields.get("search"),
      status = fields.get("status");
    next.searchParams.set("search", typeof search === "string" ? search : "");
    next.searchParams.delete("cursor");
    if (typeof status === "string" && status)
      next.searchParams.set("status", status);
    else next.searchParams.delete("status");
    next.searchParams.set("order", "activity");
    void navigate(next.pathname + next.search);
  }
  function remember(number: number) {
    continuity = {
      identity,
      url: location.pathname + location.search,
      id: `review-${number}`,
      scroll: window.scrollY,
    };
  }
  const admitted = denialStatus === null && !error && query.data;
  return {
    root,
    parameters: reviewParameters(url, kind),
    interactive,
    refreshing,
    denialStatus,
    loading: navigation.state !== "idle" || refreshing,
    page:
      kind === "list" && admitted
        ? privateReviewPageSchema.parse(query.data)
        : null,
    detail:
      kind === "detail" && admitted
        ? privateReviewDetailSchema.parse(query.data)
        : null,
    refresh,
    href,
    applyFilters,
    remember,
    returnToList,
  };
}
