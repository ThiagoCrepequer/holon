import {
  adminRunDetailV2Schema,
  adminRunDetailV3Schema,
  runIdSchema,
  type AdminRunDetailV2,
  type AdminRunDetailV3,
} from "@holon/contracts";
import * as React from "react";
import {
  data,
  type LoaderFunctionArgs,
  useLoaderData,
  useRevalidator,
} from "react-router";

import { D1AdminStorage } from "../../workers/d1-adapter.js";
import type { AdminReadRpcClient } from "../../workers/observability/readiness.js";
import { adminRequestContext } from "../server/request-context.js";
import { RunDetailView } from "../views/run-detail-view.js";

export function parseRpcRunDetail(
  value: unknown,
): AdminRunDetailV3 | AdminRunDetailV2 | null {
  if (value === null) return null;
  const parsedV3 = adminRunDetailV3Schema.safeParse(value);
  if (parsedV3.success) return parsedV3.data;
  const parsedV2 = adminRunDetailV2Schema.safeParse(value);
  if (parsedV2.success) return parsedV2.data;
  throw new Error("Invalid RPC run detail response");
}

export async function loader({ params, context }: LoaderFunctionArgs) {
  const parsedRunId = runIdSchema.safeParse(params.runId);
  if (!parsedRunId.success) throw data("Invalid run ID", { status: 400 });
  const { env, identity } = context.get(adminRequestContext);
  const run = await new D1AdminStorage(env.DB).getRunById(parsedRunId.data);
  if (!run) throw data("Run not found", { status: 404 });

  let rpcDetail: AdminRunDetailV3 | AdminRunDetailV2 | null = null;
  let rpcError: string | null = null;
  const rpc = env.ADMIN_READ_API as unknown as AdminReadRpcClient | undefined;
  if (!rpc) {
    rpcError = "Control plane RPC binding not configured";
  } else {
    try {
      const fetchPromise = rpc.getRunDetailV3
        ? rpc.getRunDetailV3({ runId: parsedRunId.data })
        : rpc.getRunDetailV2({ runId: parsedRunId.data });
      const candidate = await Promise.race([
        fetchPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5_000),
        ),
      ]);
      rpcDetail = parseRpcRunDetail(candidate);
    } catch {
      try {
        const fallback = await rpc.getRunDetailV2({ runId: parsedRunId.data });
        rpcDetail = parseRpcRunDetail(fallback);
      } catch {
        rpcError = "RPC drill-down unavailable";
      }
    }
  }

  const runState =
    rpcDetail && "runState" in rpcDetail.run
      ? rpcDetail.run.runState
      : undefined;
  const isActive =
    run.terminal_state === null ||
    runState === "running" ||
    runState === "publishing";

  return { isActive, rpcDetail, rpcError, run, userEmail: identity.email };
}

export function setupAutoPolling(
  isActive: boolean,
  revalidator: { state: string; revalidate: () => void },
  intervalMs = 3000,
): () => void {
  if (!isActive) {
    return () => {};
  }

  const tick = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      revalidator.state === "idle"
    ) {
      revalidator.revalidate();
    }
  };

  const timer = setInterval(tick, intervalMs);

  const onVisibilityChange = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      revalidator.state === "idle"
    ) {
      revalidator.revalidate();
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return () => {
    clearInterval(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

export function createRevalidatorProxy(ref: {
  readonly current: { readonly state: string; revalidate(): void };
}): { readonly state: string; revalidate(): void } {
  return {
    get state() {
      return ref.current.state;
    },
    revalidate: () => ref.current.revalidate(),
  };
}

export default function RunDetailRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const revalidatorRef = React.useRef(revalidator);
  revalidatorRef.current = revalidator;

  React.useEffect(() => {
    const proxy = createRevalidatorProxy(revalidatorRef);
    return setupAutoPolling(loaderData.isActive, proxy);
  }, [loaderData.isActive]);

  return <RunDetailView {...loaderData} embedded />;
}
