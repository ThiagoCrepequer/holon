import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { Layout } from "../app/components/layout.js";

function Workspace() {
  const { pathname } = useLocation();
  return (
    <Layout currentPath={pathname} userEmail="operator@example.com">
      <h1>{pathname === "/runs" ? "Review runs" : "System Overview"}</h1>
    </Layout>
  );
}

afterEach(cleanup);

describe("console navigation", () => {
  it("navigates between sections and exposes the current page", () => {
    render(
      <MemoryRouter>
        <Workspace />
      </MemoryRouter>,
    );
    expect(
      screen
        .getByRole("link", { name: "Overview" })
        .getAttribute("aria-current"),
    ).toBe("page");
    fireEvent.click(screen.getByRole("link", { name: "Runs" }));
    expect(screen.getByRole("heading", { name: "Review runs" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Runs" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Overview" })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(
      within(screen.getByRole("complementary")).getByText(
        "operator@example.com",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByText("Context makes the difference.")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Skip to content" })
        .getAttribute("href"),
    ).toBe(`#${screen.getByRole("main").id}`);
    expect(screen.getByRole("main").getAttribute("tabindex")).toBe("-1");
  });
});
