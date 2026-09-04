/**
 * Security headers and dynamic per-request CSP nonce generator.
 */

export function generateCspNonce(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function buildCspDirective(
  nonce: string,
  options?: { isDev?: boolean },
): string {
  const isDev = options?.isDev ?? false;
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline'"
    : `script-src 'self' 'nonce-${nonce}'`;
  const styleElem = isDev
    ? "style-src-elem 'self' 'unsafe-inline'"
    : `style-src-elem 'self' 'nonce-${nonce}'`;
  const connectSrc = isDev
    ? "connect-src 'self' ws: wss:"
    : "connect-src 'self'";

  return [
    "default-src 'self'",
    scriptSrc,
    styleElem,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    connectSrc,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function buildSecurityHeaders(
  nonce: string,
  options?: { isDev?: boolean },
): Headers {
  const headers = new Headers();
  headers.set("Content-Security-Policy", buildCspDirective(nonce, options));
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cache-Control", "private, no-store, must-revalidate");
  return headers;
}

export function applySecurityHeaders(
  response: Response,
  nonce: string,
  options?: { isDev?: boolean },
): Response {
  const newHeaders = new Headers(response.headers);
  const secHeaders = buildSecurityHeaders(nonce, options);
  secHeaders.forEach((value, key) => {
    newHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
