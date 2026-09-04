// oxlint-disable-next-line import/no-unassigned-import -- Vite extracts the design-system stylesheet.
import "@holon/ui/theme.css";
// oxlint-disable-next-line import/no-unassigned-import -- Vite extracts the application stylesheet.
import "./styles.css";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";

export function Layout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const message =
    status === 400
      ? "The request contains invalid parameters."
      : status === 404
        ? "The requested resource was not found."
        : "The console could not complete this request.";
  return (
    <main className="mx-auto max-w-2xl p-8 text-center">
      <h1 className="text-xl font-semibold">{status}</h1>
      <p className="mt-2 text-sm text-zinc-600">{message}</p>
      <a className="mt-4 inline-block underline" href="/">
        Return to overview
      </a>
    </main>
  );
}
