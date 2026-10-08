import { env, SELF, createExecutionContext } from "cloudflare:test";
import { expect, it } from "vitest";

import EmailDelivery from "../src/index.js";
it("has no public send or status endpoint", async () => {
  for (const path of ["/", "/send", "/api/send", "/health"]) {
    const response = await SELF.fetch(`https://sender.example.invalid${path}`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
});
it("validates its real private RPC without claiming delivery during bootstrap", async () => {
  const delivery = (env as { DELIVERY: Service<EmailDelivery> }).DELIVERY;
  for (const input of [
    null,
    {},
    { operationId: "valid", token: "secret" },
    { operationId: "../bad" },
  ])
    await expect(Promise.resolve(delivery.wake(input))).rejects.toThrow(
      "invalid_request",
    );
  using result = await delivery.wake({ operationId: "synthetic-operation" });
  expect(result.status).toBe("unavailable");
});

it("covers contract validation directly while RPC proves the independently built Worker", async () => {
  const entrypoint = new EmailDelivery(createExecutionContext(), env);
  await expect(entrypoint.wake(null)).rejects.toThrow("invalid_request");
  expect(await entrypoint.wake({ operationId: "synthetic-operation" })).toEqual(
    { status: "unavailable" },
  );
});
