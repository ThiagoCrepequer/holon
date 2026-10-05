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
  const body = await renderToReadableStream(
    <ServerRouter
      context={context}
      url={request.url}
      nonce={loadContext.get(nonceContext)}
    />,
    { nonce: loadContext.get(nonceContext), signal: request.signal },
  );
  await body.allReady;
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { status, headers });
}
