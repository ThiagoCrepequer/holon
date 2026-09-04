import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/table/table.js";

describe("Table component", () => {
  it("renders a full table structure with caption", () => {
    const html = renderToStaticMarkup(
      <Table className="custom-table">
        <TableCaption>Recent Runs</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Run ID</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>run-1</TableCell>
            <TableCell>completed</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Total: 1</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );

    expect(html).toContain("custom-table");
    expect(html).toContain("Recent Runs");
    expect(html).toContain("Run ID");
    expect(html).toContain("run-1");
    expect(html).toContain("Total: 1");
  });

  it("supports containerClassName and bordered options", () => {
    const defaultHtml = renderToStaticMarkup(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Item</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(defaultHtml).not.toContain("border-[var(--border)] rounded-lg");

    const borderedHtml = renderToStaticMarkup(
      <Table bordered containerClassName="custom-container">
        <TableBody>
          <TableRow>
            <TableCell>Item</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(borderedHtml).toContain("border-[var(--border)] rounded-lg");
    expect(borderedHtml).toContain("custom-container");
  });
});
