import {
  reviewListResponseSchema,
  reviewDetailResponseSchema,
} from "@holon/contracts/dashboard-reviews";
import { dehydrate } from "@tanstack/react-query";
import {
  data as routeData,
  useLoaderData,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";

import {
  createReviewQueryClient,
  loadReviews,
  reviewIdentity,
  reviewQueryKey,
  reviewResource as resource,
  ReviewScreen,
  ReviewRecovery,
  ReviewClientError,
} from "../../features/reviews/public.js";
import { viewerServicesContext } from "../../request-context.js";
import { errorResponse } from "../../server/http-security.server.js";
import { readPrivateReviews } from "../../server/private-reviews.server.js";
import type { Route } from "./+types/route";
export function meta({ matches }: Route.MetaArgs) {
  return [
    {
      title:
        matches[0]?.loaderData?.locale === "pt-BR"
          ? "Revisões · Holon"
          : "Reviews · Holon",
    },
  ];
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
  const data = useLoaderData<typeof loader>();
  return <ReviewScreen dehydrated={data.dehydrated} />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error)
    ? error.status
    : error instanceof ReviewClientError
      ? error.status
      : 503;
  return (
    <main className="holon-welcome holon-reviews">
      <ReviewRecovery status={status} />
    </main>
  );
}
