import { renderToReadableStream } from "react-dom/server";
import {
  ServerRouter,
  type EntryContext,
  type RouterContextProvider,
} from "react-router";

import { nonceContext } from "./request-context.js";
export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
  loadContext: RouterContextProvider,
) {
  const requestNonce = loadContext.get(nonceContext);
  const body = await renderToReadableStream(
    <ServerRouter context={context} url={request.url} nonce={requestNonce} />,
    { nonce: requestNonce, signal: request.signal, onError: handleError },
  );
  await body.allReady;
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { status, headers });
}

export function handleError(): void {
  // React Router invokes this instead of its default raw exception logger.
  console.error(
    JSON.stringify({
      code: "dashboard_render_error",
      requestId: crypto.randomUUID(),
    }),
  );
}
