import { reviewParameters, reviewResource } from "../../review-parameters.js";

/** Keep the exact relative review destination; never accept an external return URL. */
export function reviewReturnDestination(value: string | null): string | null {
  if (!value?.startsWith("/reviews") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://dashboard.invalid");
    if (
      !["/reviews", "/reviews/detail"].includes(url.pathname) ||
      url.origin !== "https://dashboard.invalid"
    )
      return null;
    reviewParameters(url, reviewResource(url));
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
