import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VerdictDistribution } from "../app/components/verdict-distribution.js";

afterEach(cleanup);

describe("verdict distribution", () => {
  it("shows each recorded outcome and its share of actual verdicts", () => {
    render(
      <VerdictDistribution
        distribution={{ approve: 5, requestChanges: 2, comment: 1 }}
      />,
    );
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.getByText("Request Changes")).toBeTruthy();
    expect(screen.getByText("Comment")).toBeTruthy();
    expect(
      screen.getAllByRole("definition").map((element) => element.textContent),
    ).toEqual(["5 (63%)", "2 (25%)", "1 (13%)"]);
    expect(screen.queryByText("No verdicts in this period")).toBeNull();
  });
});
