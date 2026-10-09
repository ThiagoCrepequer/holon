import { expect, it } from "vitest";

import { projectContextList } from "../src/context-projection.js";

it("keeps whole JSON entries, counts omissions and still admits smaller later entries", () => {
  const items = [
    "á".repeat(100),
    { path: "src/consumer.ts" },
    { path: "src/second.ts" },
  ];
  const result = projectContextList(items, 60);
  expect(JSON.parse(result.content)).toEqual(items.slice(1));
  expect(result).toMatchObject({ truncated: true, omitted: 1 });
  expect(
    new TextEncoder().encode(result.content).byteLength,
  ).toBeLessThanOrEqual(60);
});
