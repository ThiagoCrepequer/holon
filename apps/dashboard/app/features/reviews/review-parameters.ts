import {
  reviewListInputSchema,
  reviewDetailInputSchema,
} from "@holon/contracts/dashboard-reviews";
export type ReviewResource = "list" | "detail";
export function reviewParameters(url: URL, kind: ReviewResource) {
  const number = (key: string) => Number(url.searchParams.get(key));
  const shared = {
    workspaceId: url.searchParams.get("workspace") ?? "",
    installationId: number("installation"),
    repositoryId: number("repository"),
    cursor: url.searchParams.get("cursor"),
  };
  return kind === "list"
    ? reviewListInputSchema.parse({
        ...shared,
        status: url.searchParams.get("status"),
        search: url.searchParams.get("search") ?? "",
        limit: url.searchParams.has("limit") ? number("limit") : 50,
      })
    : reviewDetailInputSchema.parse({
        ...shared,
        pullRequestNumber: number("pullRequest"),
      });
}
export function reviewScope(url: URL) {
  return JSON.stringify([
    url.searchParams.get("workspace"),
    Number(url.searchParams.get("installation")),
    Number(url.searchParams.get("repository")),
  ]);
}
export function reviewQueryKey(
  identity: string,
  url: URL,
  kind: ReviewResource,
) {
  return [
    "reviews",
    identity,
    reviewScope(url),
    kind,
    reviewParameters(url, kind),
  ] as const;
}
