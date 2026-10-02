import { expect, it } from "vitest";

import { profileModelInput } from "./input-profile.js";

it("partitions UTF-8 request bytes into numeric-only categories", () => {
  const privateText = "private-é-🔒";
  const body = {
    model: "dynamic/local",
    messages: [
      { role: "system", content: "Instructions" },
      { role: "user", content: privateText },
      { role: "assistant", content: "Prior answer" },
      { role: "tool", content: "Prior result" },
    ],
    tools: [{ type: "function", function: { name: "read_file" } }],
    response_format: { type: "json_schema" },
  };
  const raw = JSON.stringify(body);
  const profile = profileModelInput(raw, body);
  expect(profile.totalBytes).toBe(new TextEncoder().encode(raw).byteLength);
  expect(
    profile.instructionBytes +
      profile.canonicalBytes +
      profile.historyBytes +
      profile.toolSchemaBytes +
      profile.responseFormatBytes +
      profile.otherBytes,
  ).toBe(profile.totalBytes);
  expect(profile.messages).toBe(4);
  expect(JSON.stringify(profile)).not.toContain(privateText);
  expect(
    Object.values(profile).every((value) => Number.isSafeInteger(value)),
  ).toBe(true);
});
