import { describe, expect, it, vi } from "vitest";

import { SandboxLease, type LeaseState } from "../src/sandbox-lease.js";

function fixture() {
  let now = 1_000;
  let state: LeaseState | undefined;
  const hooks = {
    now: () => now,
    load: async () => state,
    save: async (value: LeaseState) => {
      state = value;
    },
    schedule: vi.fn(async (_at: number) => {}),
    keepAlive: vi.fn(async (_enabled: boolean) => {}),
    cancelSchedules: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
  return {
    hooks,
    lease: new SandboxLease(hooks),
    time: (value: number) => {
      now = value;
    },
  };
}

describe("sandbox analysis lease", () => {
  it("expires durably after re-instantiation without renewed deadlines from tool activity", async () => {
    const f = fixture();
    await f.lease.acquire(61_000);
    expect(f.hooks.schedule).toHaveBeenCalledWith(61_000);
    expect(f.hooks.keepAlive).toHaveBeenCalledWith(true);
    f.time(61_001);
    await new SandboxLease(f.hooks).expire();
    expect(f.hooks.keepAlive).toHaveBeenLastCalledWith(false);
    expect(f.hooks.destroy).toHaveBeenCalledOnce();
  });
  it("does not let an older request or alarm shorten a newer wave lease", async () => {
    const f = fixture();
    await Promise.all([f.lease.acquire(61_000), f.lease.acquire(121_000)]);
    await f.lease.acquire(61_000);
    f.time(61_001);
    await f.lease.expire();
    expect(f.hooks.destroy).not.toHaveBeenCalled();
    f.time(121_001);
    await f.lease.expire();
    expect(f.hooks.destroy).toHaveBeenCalledOnce();
  });
  it("rejects renewal after terminal cleanup and invalid or excessive deadlines", async () => {
    const f = fixture();
    await expect(f.lease.acquire(Number.NaN)).rejects.toThrow();
    await expect(f.lease.acquire(1_000 + 20 * 60_000)).rejects.toThrow();
    await f.lease.acquire(61_000);
    await f.lease.close();
    await expect(f.lease.acquire(121_000)).rejects.toThrow();
    expect(f.hooks.keepAlive).toHaveBeenLastCalledWith(false);
  });
});

it("schedules another cleanup before a failing destroy and rejects operations without a lease", async () => {
  let state: LeaseState | undefined;
  const schedule = vi.fn(async () => {});
  const cancelSchedules = vi.fn();
  const destroy = vi.fn(async () => {
    throw new Error("unavailable");
  });
  let now = 1_000;
  const lease = new SandboxLease({
    now: () => now,
    load: async () => state,
    save: async (value) => {
      state = value;
    },
    schedule,
    keepAlive: async () => {},
    destroy,
    cancelSchedules,
  });
  await expect(lease.assertActive(2_000)).rejects.toThrow();
  await lease.acquire(61_000);
  await lease.assertActive(30_000);
  await expect(lease.assertActive(70_000)).rejects.toThrow();
  now = 61_001;
  await expect(lease.expire()).rejects.toThrow();
  expect(schedule).toHaveBeenLastCalledWith(66_001);
  expect(cancelSchedules).not.toHaveBeenCalled();
  await expect(lease.assertActive(61_000)).rejects.toThrow();
});
