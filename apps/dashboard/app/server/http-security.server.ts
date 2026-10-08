import type { DashboardErrorCode } from "@holon/contracts/dashboard";

export class HttpBoundaryError extends Error {
  constructor(
    readonly code: DashboardErrorCode,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}
export function configuredOrigin(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new HttpBoundaryError("unavailable", 503);
  return url.origin;
}
export function assertRequestOrigin(request: Request, origin: string): void {
  // Never derive authority from Host/X-Forwarded-* or a supplied return URL.
  if (new URL(request.url).origin !== origin)
    throw new HttpBoundaryError("denied", 403);
}
export function safeReturnPath(value: string, origin: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\s]/u.test(value) ||
    value.split("?")[0]?.includes("%")
  )
    throw new HttpBoundaryError("invalid_request", 400);
  const url = new URL(value, origin);
  if (url.origin !== origin || url.hash || url.pathname !== value.split("?")[0])
    throw new HttpBoundaryError("invalid_request", 400);
  return url.pathname + url.search;
}
export function nonce(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))),
  );
}
export function secureResponse(
  response: Response,
  requestNonce: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'nonce-${requestNonce}' 'strict-dynamic'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
  );
  return new Response(response.body, { status: response.status, headers });
}
export function errorResponse(error: unknown): Response {
  const known = error instanceof HttpBoundaryError;
  const headers = new Headers();
  if (known && error.retryAfter !== undefined) {
    headers.set("Retry-After", error.retryAfter.toString());
  }
  return Response.json(
    {
      error: {
        code: known ? error.code : "unavailable",
        requestId: crypto.randomUUID(),
      },
    },
    { status: known ? error.status : 503, headers },
  );
}

/** Trusted session identity and its derived CSRF token; neither is taken from the command body. */
export interface CommandSession {
  readonly sessionId: string;
  readonly csrfToken: string;
}
async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}
export async function readCommand(
  request: Request,
  origin: string,
  session: CommandSession | null,
  maxBytes = 16_384,
): Promise<unknown> {
  assertRequestOrigin(request, origin);
  if (
    request.method !== "POST" ||
    request.headers.get("Content-Type")?.split(";")[0]?.trim() !==
      "application/json"
  )
    throw new HttpBoundaryError("invalid_request", 400);
  if (
    !session ||
    !session.sessionId ||
    session.csrfToken.length < 32 ||
    request.headers.get("Origin") !== origin ||
    ["cross-site", "same-site"].includes(
      request.headers.get("Sec-Fetch-Site") ?? "",
    )
  )
    throw new HttpBoundaryError("denied", 403);
  const received = request.headers.get("X-CSRF-Token") ?? "";
  // Hash both inputs, then compare all bytes; do not emit the token in an error/log.
  const [left, right] = await Promise.all([
    digest(received),
    digest(session.csrfToken),
  ]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left[index]! ^ right[index]!;
  if (difference !== 0) throw new HttpBoundaryError("denied", 403);
  if (Number(request.headers.get("Content-Length")) > maxBytes)
    throw new HttpBoundaryError("invalid_request", 413);
  if (!request.body) throw new HttpBoundaryError("invalid_request", 400);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new HttpBoundaryError("invalid_request", 413);
    }
    parts.push(result.value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged));
  } catch {
    throw new HttpBoundaryError("invalid_request", 400);
  }
}

export async function issueSessionCsrfToken(
  sessionId: string,
  authSecret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`csrf:${sessionId}`),
  );
  return Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
