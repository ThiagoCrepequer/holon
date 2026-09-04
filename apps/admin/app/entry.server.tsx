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
  const { env, nonce } = loadContext.get(adminRequestContext);
  if (request.method === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }
  const isDev = env.DEV_BYPASS_AUTH === "true";
  const routerProps = isDev
    ? { context: routerContext, url: request.url }
    : { context: routerContext, url: request.url, nonce };
  const body = await renderToReadableStream(<ServerRouter {...routerProps} />, {
    signal: AbortSignal.timeout(6_000),
  });
  responseHeaders.set("content-type", "text/html; charset=utf-8");
  return new Response(body, {
    status: responseStatusCode,
    headers: responseHeaders,
  });
}
