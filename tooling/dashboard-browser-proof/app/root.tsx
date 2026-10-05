import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { client, bindIdentity } from "./bridge.js";
import { nonceContext } from "./request-context.js";
import { identityFor } from "./use-case.server.js";

import proofStyles from "./proof.css?url";
export function links() {
  return [{ rel: "stylesheet", href: proofStyles }];
}
export function loader({ request, context }: Route.LoaderArgs) {
  return { identity: identityFor(request), nonce: context.get(nonceContext) };
}
export default function Root() {
  const data = useLoaderData<typeof loader>();
  if (typeof window !== "undefined") bindIdentity(data.identity);
  const [queryClient] = useState(() =>
    typeof window === "undefined"
      ? new QueryClient({ defaultOptions: { queries: { enabled: false } } })
      : client(),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData<typeof loader>();
  return (
    <html lang={data?.identity.locale ?? "en"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={data?.nonce} />
        <Scripts nonce={data?.nonce} />
      </body>
    </html>
  );
}
