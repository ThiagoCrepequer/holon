import { describe, expect, it, vi } from "vitest";

const { hydrateRootMock } = vi.hoisted(() => ({
  hydrateRootMock: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  hydrateRoot: hydrateRootMock,
}));

vi.mock("react-router/dom", () => ({
  HydratedRouter: () => null,
}));

describe("client entrypoint", () => {
  it("hydrates the React Router application into the document", async () => {
    await import("../app/entry.client.js");

    expect(hydrateRootMock).toHaveBeenCalledOnce();
    expect(hydrateRootMock.mock.calls[0]?.[0]).toBe(document);
  });
});
