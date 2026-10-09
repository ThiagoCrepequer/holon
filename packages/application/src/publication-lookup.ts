import type { PublicationMarkerLookup } from "./ports.js";

export class PublicationLookupIncompleteError extends Error {
  public constructor() {
    super("Publication marker lookup is inconclusive");
    this.name = "PublicationLookupIncompleteError";
  }
}

/** An incomplete search can never authorize a new external mutation. */
export function requireConclusivePublicationLookup(
  lookup: PublicationMarkerLookup,
): Exclude<PublicationMarkerLookup, { readonly status: "inconclusive" }> {
  if (lookup.status === "inconclusive")
    throw new PublicationLookupIncompleteError();
  return lookup;
}
