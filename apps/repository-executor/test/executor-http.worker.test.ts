import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it.each([
  { method: "GET", path: "/" },
  { method: "GET", path: "/favicon.ico" },
  { method: "POST", path: "/prepareRepository" },
])(
  "rejects HTTP $method $path without invoking private RPC capabilities",
  async ({ method, path }) => {
    // This worker deliberately has no Sandbox or broker bindings in the test.
    // Handling an HTTP request must not require either capability.
    const response = await SELF.fetch(`https://executor.example${path}`, {
      method,
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  },
);
