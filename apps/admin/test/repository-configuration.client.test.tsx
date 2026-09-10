import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { RepositoryConfiguration } from "../app/components/repository-configuration.js";
import { configuration, identification } from "./configuration-fixtures.js";

afterEach(cleanup);
it("distinguishes missing compiled configuration from proven built-in defaults", () => {
  const view = render(
    <RepositoryConfiguration configuration={null} identification={null} />,
  );
  expect(
    screen.getByText("No compiled configuration was recorded for this run."),
  ).toBeTruthy();
  view.rerender(
    <RepositoryConfiguration
      configuration={{
        ...configuration,
        source: "default",
        additionalExcludes: [],
        projects: [],
        focus: [],
      }}
      identification={null}
    />,
  );
  expect(
    screen.getByText("Built-in defaults (configuration absent)"),
  ).toBeTruthy();
  expect(screen.getByText("All defect categories")).toBeTruthy();
});
it("shows effective preferences, scope associations and independent comparison states", () => {
  render(
    <RepositoryConfiguration
      configuration={configuration}
      identification={identification}
    />,
  );
  for (const text of [
    "pt-BR",
    "detailed",
    "0",
    "block_all_confident_medium",
    "3 instructions · 2 referenced files · 1 path rules",
    "Matches detected evidence",
    "Conflicts with detected evidence",
    "Comparison unavailable",
    "Not detected",
    "24.4.0",
    "18.3.1",
  ])
    expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByText(/Detected projects: detected-api/)).toBeTruthy();
  expect(screen.getByText(/mismatch alone/)).toBeTruthy();
  const disclosure = screen.getByText("Configuration provenance");
  fireEvent.click(disclosure);
  expect(screen.getByText(configuration.configDigest)).toBeTruthy();
  expect(screen.getByText("docs/generated/**")).toBeTruthy();
});
it("does not invent comparisons when identification is unavailable", () => {
  render(
    <RepositoryConfiguration
      configuration={configuration}
      identification={null}
    />,
  );
  expect(screen.getAllByText("Not compared in this run")).toHaveLength(4);
  expect(screen.getByText(/No associated detected project/)).toBeTruthy();
});
