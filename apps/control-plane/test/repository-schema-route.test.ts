import { expect, it } from "vitest";

import { createWebhookApp } from "../src/webhook-handler.js";
it("serves the build's public schema without bindings or authentication and revalidates its content ETag", async () => {
  const app = createWebhookApp();
  const response = await app.request(
    "https://holon.test/schemas/holon.schema.json",
  );
  expect(response.status).toBe(200);
  const schema = (await response.json()) as {
    $schema: string;
    additionalProperties: boolean;
    properties: { output: unknown };
  };
  expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
  expect(schema.additionalProperties).toBe(false);
  expect(schema.properties.output).toBeDefined();
  const cached = await app.request(
    "https://holon.test/schemas/holon.schema.json",
    { headers: { "If-None-Match": response.headers.get("ETag")! } },
  );
  expect(cached.status).toBe(304);
  expect(await cached.text()).toBe("");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
});

it("supports HEAD and rejects mutation methods without invoking webhook handlers", async () => {
  const app = createWebhookApp();
  const head = await app.request(
    "https://holon.test/schemas/holon.schema.json",
    { method: "HEAD" },
  );
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect(head.headers.get("ETag")).toMatch(/^"[a-f0-9]{64}"$/u);
  const post = await app.request(
    "https://holon.test/schemas/holon.schema.json",
    { method: "POST", body: "not a webhook" },
  );
  expect(post.status).toBe(405);
  expect(post.headers.get("Allow")).toBe("GET, HEAD");
  const weak = await app.request(
    "https://holon.test/schemas/holon.schema.json",
    {
      headers: {
        "If-None-Match": `"unrelated", W/${head.headers.get("ETag")}`,
      },
    },
  );
  expect(weak.status).toBe(304);
});
