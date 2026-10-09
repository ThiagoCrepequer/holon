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
it("validates its real private RPC and publishes only an opaque reference", async () => {
  const delivery = (env as unknown as { DELIVERY: Service<EmailDelivery> })
    .DELIVERY;
  for (const input of [
    null,
    {},
    { operationId: "valid", token: "secret" },
    { operationId: "../bad" },
  ]) {
    using rejected = delivery.wake(input);
    await expect(Promise.resolve(rejected)).rejects.toThrow("invalid_request");
  }
  using result = await delivery.wake({ operationId: "synthetic-operation" });
  expect(result.status).toBe("accepted");
});

it("covers contract validation directly while RPC proves the independently built Worker", async () => {
  const entrypoint = new EmailDelivery(
    createExecutionContext(),
    env as unknown as ConstructorParameters<typeof EmailDelivery>[1],
  );
  await expect(entrypoint.wake(null)).rejects.toThrow("invalid_request");
  expect(await entrypoint.wake({ operationId: "synthetic-operation" })).toEqual(
    { status: "unavailable" },
  );
});
