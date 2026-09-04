import { data } from "react-router";

export function loader() {
  throw data("Page not found", { status: 404 });
}

export function NotFoundView() {
  return (
    <main className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-xl font-semibold">404</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Page not found.
      </p>
      <a className="mt-4 inline-block underline" href="/">
        Return to overview
      </a>
    </main>
  );
}

export default NotFoundView;
