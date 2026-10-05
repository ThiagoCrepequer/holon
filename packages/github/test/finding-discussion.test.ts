import { expect, it } from "vitest";

import { createFindingDiscussionReader } from "../src/index.js";
const comment = {
  id: 202,
  body: "@holon Em qual cenário?",
  path: "src/input.ts",
  commit_id: "a".repeat(40),
  in_reply_to_id: 101,
  pull_request_url: "https://api.github.com/repos/acme/api/pulls/7",
  user: { login: "alice", type: "User" },
};
it("reads and validates live discussion identities using bounded authenticated routes", async () => {
  const calls: unknown[] = [];
  const reader = createFindingDiscussionReader(
    {
      request: async (route, params, maximum) => {
        calls.push([route, params, maximum]);
        return {
          data: route.includes("comments")
            ? comment
            : {
                number: 7,
                state: "open",
                user: { login: "alice", type: "User" },
                head: { sha: "a".repeat(40) },
                base: { sha: "b".repeat(40) },
              },
        };
      },
    },
    "acme",
    "api",
  );
  expect(await reader.comment(202)).toEqual(comment);
  expect(await reader.pullRequest(7)).toMatchObject({
    number: 7,
    state: "open",
  });
  expect(calls).toEqual([
    [
      "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}",
      { owner: "acme", repo: "api", comment_id: 202 },
      200000,
    ],
    [
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      { owner: "acme", repo: "api", pull_number: 7 },
      200000,
    ],
  ]);
});
const malformedReader = (data: unknown) =>
  createFindingDiscussionReader(
    { request: async () => ({ data }) },
    "acme",
    "api",
  );

it("rejects mismatched IDs and malformed authors or snapshots", async () => {
  await expect(
    malformedReader({ ...comment, id: 303 }).comment(202),
  ).rejects.toThrow("identity mismatch");
  await expect(
    malformedReader({ ...comment, user: { login: "alice" } }).comment(202),
  ).rejects.toThrow();
  await expect(
    malformedReader({
      number: 8,
      state: "open",
      user: { login: "alice", type: "User" },
      head: { sha: "a".repeat(40) },
      base: { sha: "b".repeat(40) },
    }).pullRequest(7),
  ).rejects.toThrow("identity mismatch");
});
