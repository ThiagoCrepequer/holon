import {
  createPrivateReviewReads,
  PrivateReviewError,
} from "@holon/application/private-review-reads";
import { coreReviewDetailResultSchema } from "@holon/contracts/dashboard-reviews";

import { reviewParameters } from "../features/reviews/public.js";
import type { DashboardServices } from "./http-context.server.js";
import { HttpBoundaryError } from "./http-security.server.js";
import {
  consumeReadRateLimit,
  mapBoundaryError,
} from "./http-services.server.js";

export function readReviewParameters(url: URL, kind: "list" | "detail") {
  try {
    return reviewParameters(url, kind);
  } catch {
    throw new HttpBoundaryError("invalid_request", 400);
  }
}
export async function readPrivateReviews(
  request: Request,
  services: DashboardServices,
  kind: "list" | "detail",
  cookies: string[],
) {
  const parameters = readReviewParameters(new URL(request.url), kind);
  await consumeReadRateLimit(request, services, "/api/reviews");
  const assertLive = () => {
    if (request.signal.aborted) throw new HttpBoundaryError("unavailable", 503);
  };
  let projectionGeneration: number | undefined;
  let identity: { userId: string; sessionId: string } | undefined;
  const reads = createPrivateReviewReads({
    async authorize(workspaceId) {
      assertLive();
      if (!services.authService || !services.collaboration)
        throw new HttpBoundaryError("unavailable", 503);
      const admission = await services.authService.getAdmittedUser(request);
      cookies.push(...admission.headers.getSetCookie());
      if (admission.status === "disconnected")
        throw new HttpBoundaryError("reconnect_required", 401);
      if (!admission.user) throw new HttpBoundaryError("denied", 403);
      const scope = await services.collaboration.authorizeReviews(
        admission.user,
        workspaceId,
      );
      identity = {
        userId: admission.user.id,
        sessionId: admission.user.sessionId,
      };
      if (
        !scope.repositories.some(
          (x) =>
            x.installationId === parameters.installationId &&
            x.repositoryId === parameters.repositoryId,
        )
      )
        throw new HttpBoundaryError("denied", 403);
      if (!services.reviewProjection)
        throw new HttpBoundaryError("unavailable", 503);
      const projectionScope = await services.reviewProjection.readScope(
        parameters.installationId,
        parameters.repositoryId,
      );
      const current = projectionScope?.generation ?? 1;
      if (
        projectionScope?.state === "rebuilding" ||
        (projectionGeneration !== undefined && projectionGeneration !== current)
      )
        throw new HttpBoundaryError("unavailable", 503);
      projectionGeneration = current;
      assertLive();
      return { ...scope, sessionId: admission.user.sessionId };
    },
    async list(input) {
      if (!services.reviewProjection)
        throw new HttpBoundaryError("unavailable", 503);
      return services.reviewProjection.list(input);
    },
    async detail(input) {
      if (!services.reviewCore) throw new HttpBoundaryError("unavailable", 503);
      const { workspaceId: _workspace, ...coordinates } = input;
      const result = coreReviewDetailResultSchema.parse(
        await services.reviewCore.detail(coordinates),
      );
      if (result.status !== "available")
        throw new HttpBoundaryError(
          result.status === "unavailable" ? "unavailable" : "invalid_request",
          result.status === "unavailable"
            ? 503
            : result.status === "revision_changed"
              ? 409
              : 400,
        );
      if (result.generation !== projectionGeneration)
        throw new HttpBoundaryError("unavailable", 503);
      return result.detail;
    },
  });
  try {
    const result =
      kind === "list"
        ? await reads.list(parameters)
        : await reads.detail(parameters);
    assertLive();
    return { identity: identity!, result };
  } catch (error) {
    if (error instanceof PrivateReviewError)
      throw new HttpBoundaryError(
        error.code,
        error.code === "denied"
          ? 403
          : error.code === "invalid_request"
            ? 400
            : 503,
      );
    if (error instanceof Error && error.message === "invalid_review_cursor")
      throw new HttpBoundaryError("invalid_request", 400);
    const mapped = mapBoundaryError(error);
    throw mapped instanceof HttpBoundaryError
      ? mapped
      : new HttpBoundaryError("unavailable", 503);
  }
}
