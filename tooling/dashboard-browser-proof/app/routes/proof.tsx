import { I18nProvider, useLingui } from "@lingui/react";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLoaderData,
  useLocation,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";

import {
  bootIdentity,
  bindIdentity,
  loadExplicit,
  diagnostics,
} from "../bridge.js";
import { translator } from "../catalogs.js";
import { key, parameters, type Dataset } from "../fixture.js";
import { repositoryHref, urlFixtures } from "../links.js";
import { readsContext } from "../request-context.js";
import type { loader as rootLoader } from "../root.js";
import { identityFor, readAuthorized } from "../use-case.server.js";
import type { Route } from "./+types/proof";
export function loader({ request, context }: Route.LoaderArgs) {
  const identity = identityFor(request);
  const input = parameters(new URL(request.url));
  const queryClient = new QueryClient();
  const dataset = readAuthorized(request);
  context.get(readsContext).count += 1;
  queryClient.setQueryData(key(identity, input), dataset, {
    updatedAt: dataset.observedAt,
  });
  return { input, dehydrated: dehydrate(queryClient) };
}
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await loadExplicit(new URL(request.url), request.signal);
  return {
    input: parameters(new URL(request.url)),
    dehydrated: { queries: [], mutations: [] },
  };
}
export default function Proof() {
  const data = useLoaderData<typeof loader>();
  const [bootstrapConsumed, setBootstrapConsumed] = useState(false);
  const [mount, setMount] = useState(0);
  useEffect(() => {
    setBootstrapConsumed(true);
  }, []);
  const root = useRouteLoaderData<typeof rootLoader>("root");
  if (!root) throw new Error("Missing root");
  const i18n = useMemo(() => translator(root.identity), [root.identity]);
  return (
    <I18nProvider i18n={i18n}>
      <HydrationBoundary
        state={bootstrapConsumed ? undefined : data.dehydrated}
      >
        <button onClick={() => setMount((value) => value + 1)}>
          Remount observer
        </button>
        <DatasetView key={mount} />
      </HydrationBoundary>
    </I18nProvider>
  );
}
function DatasetView() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  if (!root) throw new Error("Missing root");
  const { i18n } = useLingui();
  const location = useLocation();
  const url = new URL(
    location.pathname + location.search,
    "http://127.0.0.1:8793",
  );
  const input = parameters(url);
  const queryClient = useQueryClient();
  const result = useQuery<Dataset>({
    queryKey: key(root.identity, input),
    enabled: false,
    retry: false,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const lastResource = useRef(input.resource);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshBusy = useRef(false);
  const currentView = useRef("");
  const viewKey = JSON.stringify([location.key, key(root.identity, input)]);
  currentView.current = viewKey;
  async function refresh() {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    const capturedView = currentView.current;
    setRefreshing(true);
    try {
      await loadExplicit(new URL(window.location.href));
      if (currentView.current === capturedView) {
        setFailed(false);
        setDenied(false);
      }
    } catch {
      if (currentView.current === capturedView) setFailed(true);
    } finally {
      if (currentView.current === capturedView) {
        setRefreshing(false);
        refreshBusy.current = false;
      }
    }
  }
  useEffect(() => {
    setReady(true);
  }, []);
  useEffect(() => {
    if (lastResource.current !== input.resource) {
      heading.current?.focus({ preventScroll: true });
      lastResource.current = input.resource;
    }
  }, [input.resource]);
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useState(input.term);
  const [, setSearchParams] = useSearchParams();
  useEffect(() => {
    const matches = (event: Event) => {
      const scope: unknown = (event as CustomEvent).detail;
      return (
        Array.isArray(scope) &&
        scope[1] === root.identity.user &&
        (scope[2] === undefined || scope[2] === input.resource)
      );
    };
    const deniedListener = (event: Event) => {
      if (matches(event)) setDenied(true);
    };
    const allowedListener = (event: Event) => {
      if (matches(event)) setDenied(false);
    };
    window.addEventListener("proof-denied", deniedListener);
    window.addEventListener("proof-authorized", allowedListener);
    return () => {
      window.removeEventListener("proof-denied", deniedListener);
      window.removeEventListener("proof-authorized", allowedListener);
    };
  }, [root.identity.user, input.resource]);
  useEffect(() => {
    setDenied(false);
    setFailed(false);
    setRefreshing(false);
    refreshBusy.current = false;
  }, [viewKey]);
  useEffect(() => {
    setDraft(input.term);
  }, [input.term]);
  useEffect(() => {
    // Test-only observation/control lives exclusively in this loopback harness.
    Object.assign(window, {
      proofHarness: {
        diagnostics,
        load: (path: string) =>
          loadExplicit(new URL(path, window.location.origin)),
        identity: bootIdentity,
        switchIdentity: () => bindIdentity({ ...bootIdentity(), user: "bob" }),
        invalidate: () => queryClient.invalidateQueries(),
        data: () => queryClient.getQueryData(key(root.identity, input)),
      },
    });
  }, [input.resource, input.term, input.page, queryClient, root.identity]);
  return (
    <main>
      <h1 ref={heading} tabIndex={-1}>
        {i18n._({ id: "heading", message: "Read proof" })}
      </h1>
      <p data-testid="announcement" aria-live="polite" aria-atomic="true">
        {i18n._({ id: "heading", message: "Read proof" })}: {input.resource}
      </p>
      <nav>
        <Link to="/proof/a">A</Link> <Link to="/proof/b">B</Link>
      </nav>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSearchParams({ q: draft }, { preventScrollReset: true });
        }}
      >
        <label>
          Search
          <input
            aria-label="Search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button>Apply</button>
      </form>
      <button
        onClick={() =>
          setSearchParams(
            { q: input.term, page: String(input.page + 1) },
            { preventScrollReset: true },
          )
        }
      >
        Next
      </button>
      <button
        aria-disabled={refreshing}
        onClick={() => {
          void refresh();
        }}
      >
        {i18n._({ id: "refresh", message: "Refresh" })}
      </button>
      {failed && !denied ? <p role="status">Refresh failed</p> : null}
      {denied ? (
        <p role="alert">
          {i18n._({ id: "denied", message: "Access unavailable" })}
        </p>
      ) : result.data ? (
        <article data-testid="dataset">
          <p>
            {result.data.user}:{result.data.resource}:{result.data.term}:
            {result.data.page}
          </p>
          <p data-testid="hostile">{result.data.text}</p>
          <p>
            {i18n._({
              id: "count",
              message: "Items: {count, plural, one {# item} other {# items}}",
              values: { count: input.page },
            })}
          </p>
          <time>
            {new Intl.DateTimeFormat(root.identity.locale, {
              timeZone: root.identity.zone,
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date("2026-10-05T10:00:00Z"))}
          </time>
        </article>
      ) : (
        <p>Pending</p>
      )}
      <ul data-testid="links">
        {urlFixtures.map((raw) => (
          <li key={raw}>
            {repositoryHref(raw) ? (
              <a href={repositoryHref(raw)}>Repository</a>
            ) : (
              <span>Blocked link</span>
            )}
          </li>
        ))}
      </ul>
      <p data-testid="ready">{ready ? "Hydrated" : "SSR"}</p>
    </main>
  );
}
export function ErrorBoundary() {
  return (
    <main>
      <p role="alert">Access unavailable</p>
    </main>
  );
}
