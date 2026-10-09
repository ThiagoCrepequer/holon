import { expect, it } from "vitest";

import {
  PublicationLookupIncompleteError,
  requireConclusivePublicationLookup,
} from "../src/publication-lookup.js";

it("preserves a conclusive existing marker and its reconciled body", () => {
  expect(
    requireConclusivePublicationLookup({
      status: "found",
      id: 42,
      body: "Published review",
    }),
  ).toEqual({
    status: "found",
    id: 42,
    body: "Published review",
  });
  expect(requireConclusivePublicationLookup({ status: "absent" })).toEqual({
    status: "absent",
  });
});

it("refuses to authorize publication from an incomplete marker search", () => {
  expect(() =>
    requireConclusivePublicationLookup({
      status: "inconclusive",
      reason: "page_limit",
    }),
  ).toThrow(PublicationLookupIncompleteError);
});
