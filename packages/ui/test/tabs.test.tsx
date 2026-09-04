import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "../src/components/tabs/tabs.js";

describe("Tabs component", () => {
  it("renders tabs structure with list and tabs", () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTab value="tab1">First</TabsTab>
          <TabsTab value="tab2">Second</TabsTab>
        </TabsList>
        <TabsPanel value="tab1">Content 1</TabsPanel>
        <TabsPanel value="tab2">Content 2</TabsPanel>
      </Tabs>,
    );

    expect(html).toContain("First");
    expect(html).toContain("Second");
    expect(html).toContain("Content 1");
  });
});
