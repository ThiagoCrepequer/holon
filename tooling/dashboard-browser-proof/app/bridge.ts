import { QueryClient } from "@tanstack/react-query";

import { key, parameters, type Dataset, type Identity } from "./fixture.js";
const queryConfiguration = {
  defaultOptions: {
    queries: {
      enabled: false,
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: false,
    },
  },
} as const;
let browserClient: QueryClient | undefined;
export function client() {
  if (typeof window === "undefined") throw new Error("Browser client only");
  return (browserClient ??= new QueryClient(queryConfiguration));
}
let currentIdentity: Identity | undefined;
let generation = 0;
let intent = 0;
let sessionInvalid = false;
let currentKey = "";
const active = new Map<
  string,
  { intent: number; controller: AbortController; scope: string }
>();
const latest = new Map<string, number>();
const confirmed = new Map<string, number>();
const revokedBefore = new Map<string, number>();
export function bootIdentity() {
  if (!currentIdentity) throw new Error("Missing bootstrap");
  return currentIdentity;
}
export function bindIdentity(identity: Identity) {
  if (currentIdentity?.user !== identity.user) {
    generation += 1;
    sessionInvalid = false;
    for (const read of active.values()) read.controller.abort();
    active.clear();
    latest.clear();
    confirmed.clear();
    revokedBefore.clear();
    client().clear();
  }
  currentIdentity = identity;
}
export class Denied extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 403,
  ) {
    super(message);
  }
}
export class InvalidDataset extends Error {}
function cancelled() {
  return new DOMException("Cancelled read", "AbortError");
}
// Network belongs to the explicit Router/refresh intention. Query is only the
// dataset cache + passive observer; its request deduplication/revert is bypassed
// through supported setQueryData/removeQueries, never through internal state.
export async function loadExplicit(url: URL, signal?: AbortSignal) {
  const identity = bootIdentity();
  if (sessionInvalid) throw new Denied("Session invalid", 401);
  const capturedGeneration = generation;
  const capturedIntent = ++intent;
  const input = parameters(url);
  const queryKey = key(identity, input);
  const serializedKey = JSON.stringify(queryKey);
  const affectedScope = ["proof-dataset", identity.user, input.resource];
  const scopeKey = JSON.stringify(affectedScope);
  const controller = new AbortController();
  active.get(serializedKey)?.controller.abort();
  active.set(serializedKey, {
    intent: capturedIntent,
    controller,
    scope: scopeKey,
  });
  latest.set(serializedKey, capturedIntent);
  currentKey = serializedKey;
  const combinedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  function stillOwned() {
    return (
      !combinedSignal.aborted &&
      generation === capturedGeneration &&
      latest.get(serializedKey) === capturedIntent &&
      capturedIntent > (revokedBefore.get(scopeKey) ?? 0)
    );
  }
  try {
    const endpoint = new URL(
      "/api/read/" + encodeURIComponent(input.resource),
      url.origin,
    );
    endpoint.search = url.search;
    const response = await fetch(endpoint, { signal: combinedSignal });
    if (response.status === 401) throw new Denied("Session invalid", 401);
    if (response.status === 403) throw new Denied("Denied", 403);
    if (!response.ok) throw new Error("Transient");
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (combinedSignal.aborted) throw cancelled();
      throw new InvalidDataset("Malformed JSON");
    }
    if (
      !data ||
      typeof data !== "object" ||
      !("user" in data) ||
      data.user !== identity.user ||
      !("resource" in data) ||
      data.resource !== input.resource ||
      !("term" in data) ||
      data.term !== input.term ||
      !("page" in data) ||
      data.page !== input.page ||
      !("text" in data) ||
      typeof data.text !== "string" ||
      !("observedAt" in data) ||
      typeof data.observedAt !== "number" ||
      !Number.isFinite(data.observedAt)
    )
      throw new InvalidDataset("Invalid DTO");
    if (!stillOwned()) throw cancelled();
    const dataset: Dataset = {
      user: data.user,
      resource: data.resource,
      term: data.term,
      page: data.page,
      text: data.text,
      observedAt: data.observedAt,
    };
    client().setQueryData(queryKey, dataset, { updatedAt: dataset.observedAt });
    confirmed.set(
      scopeKey,
      Math.max(confirmed.get(scopeKey) ?? 0, capturedIntent),
    );
    if (capturedIntent === intent && currentKey === serializedKey)
      window.dispatchEvent(
        new CustomEvent("proof-authorized", { detail: affectedScope }),
      );
    return dataset;
  } catch (error) {
    if (error instanceof Denied && error.status === 401 && stillOwned()) {
      sessionInvalid = true;
      generation += 1;
      for (const read of active.values()) read.controller.abort();
      active.clear();
      latest.clear();
      confirmed.clear();
      revokedBefore.clear();
      client().clear();
      window.dispatchEvent(
        new CustomEvent("proof-denied", {
          detail: ["proof-dataset", identity.user],
        }),
      );
    } else if (
      (error instanceof Denied || error instanceof InvalidDataset) &&
      stillOwned()
    ) {
      if ((confirmed.get(scopeKey) ?? 0) > capturedIntent) {
        // A later successful authorization supersedes this old denial. Its
        // current key must never be removed by an older response.
        client().removeQueries({ queryKey, exact: true });
      } else {
        revokedBefore.set(
          scopeKey,
          Math.max(revokedBefore.get(scopeKey) ?? 0, capturedIntent),
        );
        for (const read of active.values()) {
          if (read.scope === scopeKey && read.intent < capturedIntent)
            read.controller.abort();
        }
        client().removeQueries({ queryKey: affectedScope });
        window.dispatchEvent(
          new CustomEvent("proof-denied", { detail: affectedScope }),
        );
      }
    }
    throw error;
  } finally {
    if (active.get(serializedKey)?.intent === capturedIntent)
      active.delete(serializedKey);
    if (latest.get(serializedKey) === capturedIntent)
      latest.delete(serializedKey);
    // Causal scope metadata is needed only while older reads can still finish.
    // Query alone retains completed datasets with its own GC lifecycle.
    if (![...active.values()].some((read) => read.scope === scopeKey)) {
      confirmed.delete(scopeKey);
      revokedBefore.delete(scopeKey);
    }
  }
}
export function diagnostics() {
  return {
    generation,
    active: active.size,
    ownership: {
      keys: latest.size,
      confirmed: confirmed.size,
      revoked: revokedBefore.size,
    },
    keys: client()
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey),
    snapshots: client()
      .getQueryCache()
      .getAll()
      .map((query) => ({ key: query.queryKey, data: query.state.data })),
  };
}
