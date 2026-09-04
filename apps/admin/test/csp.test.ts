import { describe, expect, it } from "vitest";

import {
  applySecurityHeaders,
  buildCspDirective,
  buildSecurityHeaders,
  generateCspNonce,
} from "../workers/security/csp.js";

describe("CSP and security headers", () => {
  it("generates a 32-character hex nonce", () => {
    const nonce1 = generateCspNonce();
    const nonce2 = generateCspNonce();
    expect(nonce1).toHaveLength(32);
    expect(nonce2).toHaveLength(32);
    expect(nonce1).not.toBe(nonce2);
    expect(/^[0-9a-f]{32}$/.test(nonce1)).toBe(true);
  });

  it("builds correct CSP directive containing nonce", () => {
    const nonce = "1234567890abcdef1234567890abcdef";
    const csp = buildCspDirective(nonce);

    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}'`);
    expect(csp).toContain(`style-src-elem 'self' 'nonce-${nonce}'`);
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("builds complete security headers", () => {
    const nonce = "1234567890abcdef1234567890abcdef";
    const headers = buildSecurityHeaders(nonce);

    expect(headers.get("Content-Security-Policy")).toContain(nonce);
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Cache-Control")).toBe(
      "private, no-store, must-revalidate",
    );
  });

  it("applies security headers to an existing response", () => {
    const baseResponse = new Response("Hello", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

    const nonce = generateCspNonce();
    const secured = applySecurityHeaders(baseResponse, nonce);

    expect(secured.status).toBe(200);
    expect(secured.headers.get("content-type")).toBe("text/html");
    expect(secured.headers.get("X-Frame-Options")).toBe("DENY");
    expect(secured.headers.get("Content-Security-Policy")).toContain(nonce);
  });
});
