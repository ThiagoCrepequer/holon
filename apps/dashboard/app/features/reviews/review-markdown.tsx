import { Lexer, type Token, type Tokens } from "marked";
import { createElement, type ReactNode } from "react";

import { ReviewCode } from "./review-code.js";

function evidenceLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
/** Use the lexer only. Fixed React elements escape text; no HTML parser, plugins or remote media. */
export function ReviewMarkdown({ children }: { children: string }) {
  let remaining = 768;
  function render(tokens: Token[], depth = 0): ReactNode[] {
    if (depth > 16) throw new Error("markdown_depth");
    return tokens.map((token, key) => {
      if (--remaining < 0) throw new Error("markdown_nodes");
      const text = () =>
        render("tokens" in token ? (token.tokens ?? []) : [], depth + 1);
      switch (token.type) {
        case "space":
          return null;
        case "html":
          return token.block ? (
            <ReviewCode key={key}>
              <code>{token.text}</code>
            </ReviewCode>
          ) : (
            <span key={key}>{token.text}</span>
          );
        case "paragraph":
          return <p key={key}>{text()}</p>;
        case "text":
          return token.tokens ? <span key={key}>{text()}</span> : token.text;
        case "heading":
          return createElement(`h${Math.max(3, token.depth)}`, { key }, text());
        case "strong":
          return <strong key={key}>{text()}</strong>;
        case "em":
          return <em key={key}>{text()}</em>;
        case "del":
          return <del key={key}>{text()}</del>;
        case "br":
          return <br key={key} />;
        case "hr":
          return <hr key={key} />;
        case "codespan":
          return <code key={key}>{token.text}</code>;
        case "code":
          return (
            <ReviewCode key={key}>
              <code>{token.text}</code>
            </ReviewCode>
          );
        case "blockquote":
          return <blockquote key={key}>{text()}</blockquote>;
        case "image":
          return <span key={key}>{token.text}</span>;
        case "link": {
          const href = evidenceLink(token.href);
          return href ? (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer">
              {text()}
            </a>
          ) : (
            <span key={key}>{text()}</span>
          );
        }
        case "list":
          return createElement(
            token.ordered ? "ol" : "ul",
            { key },
            (token as Tokens.List).items.map((item, index) => (
              <li key={index}>
                {item.task ? (item.checked ? "☑ " : "☐ ") : null}
                {render(item.tokens, depth + 1)}
              </li>
            )),
          );
        // Tables and any future lexer token stay source text, with no dynamic attributes/elements.
        default:
          return <ReviewCode key={key}>{token.raw}</ReviewCode>;
      }
    });
  }
  let content: ReactNode;
  try {
    content = render(Lexer.lex(children, { gfm: true }));
  } catch {
    content = <ReviewCode>{children}</ReviewCode>;
  }
  return <div className="holon-review-markdown">{content}</div>;
}
