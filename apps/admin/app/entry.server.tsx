import { renderToReadableStream } from "react-dom/server";
import {
  ServerRouter,
  type EntryContext,
  type RouterContextProvider,
} from "react-router";

import { adminRequestContext } from "./server/request-context.js";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  const { nonce } = loadContext.get(adminRequestContext);
  if (request.method === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
    { signal: AbortSignal.timeout(6_000) },
  );
  responseHeaders.set("content-type", "text/html; charset=utf-8");
  return new Response(body, {
    status: responseStatusCode,
    headers: responseHeaders,
  });
}
