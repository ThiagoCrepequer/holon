import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { ReviewMarkdown } from "../app/features/reviews/review-markdown.js";
import { reviewReturnDestination } from "../app/features/reviews/review-return.js";

it("renders Markdown while keeping HTML literal and blocking automatic remote content", () => {
  const html = renderToStaticMarkup(
    createElement(ReviewMarkdown, {
      children:
        '**Diagnosis**\n\n<script>hostile()</script><svg onload=hostile()>\n\n![tracking](https://tracker.example/pixel)\n\n[unsafe](javascript:hostile()) [data](data:text/html,unsafe) [relative](/api/auth/session) [safe](https://docs.example/evidence)\n\n```ts\nconst original = "<script>";\n```',
    }),
  );
  expect(html).toContain("<strong>Diagnosis</strong>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toMatch(/<(script|svg|img|iframe)\b/u);
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="data:');
  expect(html).not.toContain('href="/api/');
  expect(html).toContain('href="https://docs.example/evidence"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain("const original =");
});

it("keeps source code and diagnostics independent of the interface language", () => {
  const source = '```\n// revisão / review\nconst Straße = "é";\n```';
  expect(
    renderToStaticMarkup(createElement(ReviewMarkdown, { children: source })),
  ).toContain("const Straße");
});

it("supports the bounded formatting subset while refusing credential URLs and unknown token attributes", () => {
  const html = renderToStaticMarkup(
    createElement(ReviewMarkdown, {
      children:
        "# Heading\n\n> *emphasis* ~~deleted~~ `code`\n\n1. first\n2. second\n\n- [x] checked\n- [ ] open\n\n---\n\n[credentials](https://user:password@example.invalid) [mail](mailto:private@example.invalid)\n\n| column |\n|---|\n| value |",
    }),
  );
  expect(html).toContain("<h3>Heading</h3>");
  expect(html).toContain("<blockquote>");
  expect(html).toContain("<em>emphasis</em>");
  expect(html).toContain("<del>deleted</del>");
  expect(html).toContain("<ol>");
  expect(html).toContain("☑");
  expect(html).not.toContain("href=");
  expect(html).toContain("| column |");
});
it("deep or excessive markup falls back to literal source with a single keyboard accessible block", () => {
  for (const children of [
    Array.from({ length: 800 }, () => "*x*").join(" "),
    "> ".repeat(20) + "deep",
  ]) {
    const html = renderToStaticMarkup(
      createElement(ReviewMarkdown, { children }),
    );
    expect(html).toMatch(/<pre[^>]*tabindex="0"[^>]*>/u);
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("<blockquote>");
  }
});

it("account return destinations keep scoped URLs and refuse external or invalid targets", () => {
  const path =
    "/reviews/detail?workspace=team&installation=1&repository=2&pullRequest=3&lang=pt-BR&search=rare";
  expect(reviewReturnDestination(path)).toBe(path);
  for (const invalid of [
    null,
    "https://hostile.example/reviews",
    "//hostile.example/reviews",
    "/reviews/../api/auth/session",
    "/reviews?workspace=team",
    "/reviews\\hostile",
  ])
    expect(reviewReturnDestination(invalid)).toBeNull();
});
