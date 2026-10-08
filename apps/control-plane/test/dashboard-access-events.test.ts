import { expect, it, vi } from "vitest";

import {
  dispatchDashboardAccessMessages,
  forwardDashboardAccessEvent,
} from "../src/ingress/dashboard-access-events.js";
const access = {
  deliveryId: "synthetic_delivery",
  installationId: 77,
  action: "suspended" as const,
};
it("validates the private RPC payload and fails when capability is absent", async () => {
  const applyEvent = vi.fn(async () => {});
  await forwardDashboardAccessEvent(
    { DASHBOARD_ACCESS_EVENTS: { applyEvent } },
    access,
  );
  expect(applyEvent).toHaveBeenCalledWith(access);
  await expect(forwardDashboardAccessEvent({}, access)).rejects.toThrow(
    "invalid dashboard access binding",
  );
  await expect(
    forwardDashboardAccessEvent({ DASHBOARD_ACCESS_EVENTS: 42 }, access),
  ).rejects.toThrow();
});
it("acknowledges only after invalidation and retries failed RPC without a new operation", async () => {
  const good = {
    body: { event: "github_access", access },
    ack: vi.fn(),
    retry: vi.fn(),
  };
  const invalid = {
    body: { event: "github_access", access: { bad: true } },
    ack: vi.fn(),
    retry: vi.fn(),
  };
  const applyEvent = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic outage"))
    .mockResolvedValue(undefined);
  await dispatchDashboardAccessMessages([good, invalid], {
    DASHBOARD_ACCESS_EVENTS: { applyEvent },
  });
  expect(good.retry).toHaveBeenCalledOnce();
  expect(good.ack).not.toHaveBeenCalled();
  expect(invalid.ack).toHaveBeenCalledOnce();
  await dispatchDashboardAccessMessages([good], {
    DASHBOARD_ACCESS_EVENTS: { applyEvent },
  });
  expect(good.ack).toHaveBeenCalledOnce();
  expect(applyEvent).toHaveBeenLastCalledWith(access);
});
