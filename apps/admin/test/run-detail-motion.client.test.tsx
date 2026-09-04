import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunDetailView } from "../app/views/run-detail-view.js";
import type { AdminRunRow } from "../workers/types.js";

const baseRun: AdminRunRow = {
  analysis_started_at: "2026-09-04T11:00:02.000Z",
  estimated_cost_micro_usd: 1234,
  execution_duration_ms: 2_000,
  head_sha: "a".repeat(40),
  input_tokens: 10,
  is_degraded: 0,
  output_tokens: 5,
  payload_hash: "b".repeat(64),
  pr_key: "github:42:pr:7",
  pr_number: 7,
  pricing_model: "test-model",
  projected_at: "2026-09-04T11:00:06.000Z",
  projected_at_epoch_ms: 1_788_519_606_000,
  projection_delivery_lag_ms: 1_000,
  projection_requested_at: "2026-09-04T11:00:05.000Z",
  record_version: 1,
  repository_id: 42,
  repository_name: "holon",
  repository_owner: "acme",
  review_admission_wait_ms: 100,
  review_phase_reached: "publishing",
  reasoning_tokens: 2,
  run_id: `github:42:pr:7:head:${"a".repeat(40)}`,
  schema_version: 1,
  scope_status: "complete",
  shards_count: 1,
  source_event_id: "event-1",
  terminal_at: "2026-09-04T11:00:05.000Z",
  terminal_at_epoch_ms: 1_788_519_605_000,
  terminal_state: "completed",
  tool_calls_count: 1,
  verdict: "APPROVE",
  webhook_received_at: "2026-09-04T11:00:00.000Z",
  workflow_started_at: "2026-09-04T11:00:01.000Z",
};

afterEach(cleanup);

describe("run detail dismissal", () => {
  it.each(["Close", "Escape", "Back to list", "Runs"])(
    "waits for exit motion before navigating via %s",
    async (action) => {
      render(
        <MemoryRouter initialEntries={["/runs/detail"]}>
          <Routes>
            <Route path="/runs" element={<h1>Review list</h1>} />
            <Route
              path="/runs/detail"
              element={
                <RunDetailView run={baseRun} rpcDetail={null} embedded />
              }
            />
          </Routes>
        </MemoryRouter>,
      );
      const dialog = await screen.findByRole("dialog", { name: "Run detail" });
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const getAnimations = vi.fn(() => [{ finished }]);
      Object.defineProperty(dialog, "getAnimations", {
        configurable: true,
        value: getAnimations,
      });
      if (action === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
      else if (action === "Close")
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
      else
        fireEvent.click(
          screen.getByRole("link", {
            name: action === "Runs" ? "Runs" : /Back to list/,
          }),
        );

      await waitFor(() =>
        expect(dialog.hasAttribute("data-ending-style")).toBe(true),
      );
      await waitFor(() => expect(getAnimations).toHaveBeenCalled());
      expect(document.body.contains(dialog)).toBe(true);
      expect(screen.queryByRole("heading", { name: "Review list" })).toBeNull();
      await act(async () => {
        finish();
        await finished;
      });
      expect(
        await screen.findByRole("heading", { name: "Review list" }),
      ).toBeDefined();
      expect(document.body.contains(dialog)).toBe(false);
    },
  );
});

it("returns to the list when there are no active animations", async () => {
  render(
    <MemoryRouter initialEntries={["/runs/detail"]}>
      <Routes>
        <Route path="/runs" element={<h1>Review list</h1>} />
        <Route
          path="/runs/detail"
          element={<RunDetailView run={baseRun} rpcDetail={null} embedded />}
        />
      </Routes>
    </MemoryRouter>,
  );
  const dialog = await screen.findByRole("dialog", { name: "Run detail" });
  Object.defineProperty(dialog, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(
    await screen.findByRole("heading", { name: "Review list" }),
  ).toBeDefined();
});
