import { I18nProvider } from "@lingui/react";
import { useMemo } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteLoaderData,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";

import type { Route } from "./+types/root";
import { translator } from "./i18n/catalogs.js";
import { resolveLocale } from "./i18n/locale.js";
import { loadMessages } from "./i18n/messages.server.js";
import { nonceContext } from "./request-context.js";

import stylesheet from "./styles.css?url";
export function links() {
  return [
    { rel: "stylesheet", href: stylesheet },
    { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  ];
}
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const locale = resolveLocale(
    url.searchParams.get("lang"),
    request.headers.get("Accept-Language"),
  );
  return {
    locale,
    messages: await loadMessages(locale),
    theme: url.searchParams.get("theme") === "dark" ? "dark" : "light",
    timezone: "UTC",
    nonce: context.get(nonceContext),
  };
}
export default function Root() {
  const data = useLoaderData<typeof loader>();
  const i18n = useMemo(
    () => translator(data.locale, data.messages),
    [data.locale, data.messages],
  );
  return (
    <I18nProvider i18n={i18n}>
      <Outlet />
    </I18nProvider>
  );
}
export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData<typeof loader>();
  return (
    <html lang={data?.locale ?? "en"} data-holon-theme={data?.theme ?? "light"}>
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

export function ErrorBoundary() {
  const data = useRouteLoaderData<typeof loader>("root");
  const error = useRouteError();
  const i18n = translator(data?.locale ?? "en", data?.messages ?? {});
  return (
    <main className="holon-welcome">
      <p role="alert">
        {isRouteErrorResponse(error) && error.status === 404
          ? i18n._({ id: "error.page", message: "Page unavailable" })
          : i18n._({
              id: "error.service",
              message: "Service unavailable. Please try again.",
            })}
      </p>
    </main>
  );
}
