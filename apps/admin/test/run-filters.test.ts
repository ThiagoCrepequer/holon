import { describe, expect, it } from "vitest";

import { parseRunFilters } from "../app/server/run-filters.js";

describe("parseRunFilters", () => {
  it("parses repository, order and pagination filters", () => {
    expect(
      parseRunFilters(
        new URLSearchParams(
          "repositoryId=42&period=7d&order=asc&pageSize=20&q=owner%2Frepo%237",
        ),
      ),
    ).toMatchObject({
      order: "asc",
      pageSize: 20,
      period: "7d",
      repositoryId: 42,
      searchQuery: "owner/repo#7",
    });
  });

  it.each([
    "repositoryId=invalid",
    "repositoryId=0",
    "period=year",
    "state=running",
    "verdict=MAYBE",
    "order=random",
    "pageSize=10",
  ])("rejects invalid filters instead of silently defaulting: %s", (query) => {
    expect(() => parseRunFilters(new URLSearchParams(query))).toThrow();
  });
});
