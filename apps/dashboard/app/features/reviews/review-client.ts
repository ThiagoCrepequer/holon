import {
  reviewListResponseSchema,
  reviewDetailResponseSchema,
} from "@holon/contracts/dashboard-reviews";
import { QueryClient } from "@tanstack/react-query";

import {
  reviewParameters,
  reviewScope,
  reviewQueryKey,
  type ReviewResource,
} from "../../review-parameters.js";

export class ReviewClientError extends Error {
  constructor(public readonly status: number) {
    super("private_review_read_failed");
  }
}
export function createReviewQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        enabled: false,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
      },
    },
  });
}
let browserClient: QueryClient | undefined;
let identity: string | null = null,
  generation = 0,
  intent = 0;
const active = new Map<
  string,
  { controller: AbortController; scope: string; intent: number }
>();
const confirmed = new Map<string, number>();
export function reviewClient() {
  if (typeof window === "undefined")
    throw new Error("Browser query client required");
  return (browserClient ??= createReviewQueryClient());
}
export function bindReviewIdentity(next: string | null) {
  if (identity === next) return;
  generation++;
  identity = next;
  for (const read of active.values()) read.controller.abort();
  active.clear();
  confirmed.clear();
  browserClient?.clear();
}
export function reviewIdentity(userId: string, sessionId: string) {
  return JSON.stringify([userId, sessionId]);
}
export async function loadReviews(
  url: URL,
  kind: ReviewResource,
  signal: AbortSignal,
) {
  reviewParameters(url, kind);
  if (!identity) throw new ReviewClientError(401);
  const capturedIdentity = identity,
    capturedGeneration = generation,
    capturedIntent = ++intent;
  const scope = reviewScope(url),
    key = reviewQueryKey(capturedIdentity, url, kind),
    serialized = JSON.stringify(key),
    controller = new AbortController();
  active.get(serialized)?.controller.abort();
  active.set(serialized, { controller, scope, intent: capturedIntent });
  const combined = AbortSignal.any([signal, controller.signal]);
  const owned = () =>
    !combined.aborted &&
    identity === capturedIdentity &&
    generation === capturedGeneration &&
    active.get(serialized)?.intent === capturedIntent;
  try {
    const response = await fetch(`/api/reviews/${kind}${url.search}`, {
      credentials: "same-origin",
      signal: combined,
    });
    if (!response.ok) throw new ReviewClientError(response.status);
    const value =
      kind === "list"
        ? reviewListResponseSchema.parse(await response.json())
        : reviewDetailResponseSchema.parse(await response.json());
    if (
      reviewIdentity(value.identity.userId, value.identity.sessionId) !==
      capturedIdentity
    )
      throw new ReviewClientError(401);
    if (kind === "detail") {
      const detail = reviewDetailResponseSchema.parse(value).result;
      const parameters = reviewParameters(url, "detail");
      if (
        !("pullRequestNumber" in parameters) ||
        detail.review.installationId !== parameters.installationId ||
        detail.review.repositoryId !== parameters.repositoryId ||
        detail.review.pullRequestNumber !== parameters.pullRequestNumber
      )
        throw new ReviewClientError(403);
    } else {
      const page = reviewListResponseSchema.parse(value).result;
      const parameters = reviewParameters(url, "list");
      if (
        page.items.some(
          (x) =>
            x.installationId !== parameters.installationId ||
            x.repositoryId !== parameters.repositoryId,
        )
      )
        throw new ReviewClientError(403);
    }
    if (owned()) {
      const observedAt =
        kind === "list"
          ? reviewListResponseSchema.parse(value).result.observedAt
          : reviewDetailResponseSchema.parse(value).result.review.observedAt;
      reviewClient().setQueryData(key, value.result, {
        updatedAt: Date.parse(observedAt),
      });
      confirmed.set(scope, Math.max(confirmed.get(scope) ?? 0, capturedIntent));
    }
  } catch (error) {
    if (owned()) {
      const status = error instanceof ReviewClientError ? error.status : 403;
      if (status === 401) {
        bindReviewIdentity(null);
        window.dispatchEvent(new Event("holon:reviews-session-lost"));
      } else if (
        (status === 403 || status === 409) &&
        (confirmed.get(scope) ?? 0) <= capturedIntent
      ) {
        reviewClient().removeQueries({
          predicate: (query) =>
            query.queryKey[0] === "reviews" && query.queryKey[2] === scope,
        });
        for (const read of active.values())
          if (read.scope === scope && read.intent < capturedIntent)
            read.controller.abort();
        window.dispatchEvent(
          new CustomEvent("holon:reviews-scope-lost", { detail: scope }),
        );
      } else reviewClient().removeQueries({ queryKey: key, exact: true });
    }
    throw error;
  } finally {
    if (active.get(serialized)?.intent === capturedIntent)
      active.delete(serialized);
    if (![...active.values()].some((x) => x.scope === scope))
      confirmed.delete(scope);
  }
}
