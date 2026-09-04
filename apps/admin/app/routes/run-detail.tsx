import { adminRunDetailV1Schema, runIdSchema } from "@holon/contracts";
import { data, type LoaderFunctionArgs, useLoaderData } from "react-router";

import { D1AdminStorage } from "../../workers/d1-adapter.js";
import type { AdminReadRpcClient } from "../../workers/observability/readiness.js";
import { adminRequestContext } from "../server/request-context.js";
import { RunDetailView } from "../views/run-detail-view.js";

export function parseRpcRunDetail(value: unknown) {
  if (value === null) return null;
  const parsed = adminRunDetailV1Schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid RPC run detail response");
  return parsed.data;
}

export async function loader({ params, context }: LoaderFunctionArgs) {
  const parsedRunId = runIdSchema.safeParse(params.runId);
  if (!parsedRunId.success) throw data("Invalid run ID", { status: 400 });
  const { env, identity } = context.get(adminRequestContext);
  const run = await new D1AdminStorage(env.DB).getRunById(parsedRunId.data);
  if (!run) throw data("Run not found", { status: 404 });

  let rpcDetail = null;
  let rpcError: string | null = null;
  const rpc = env.ADMIN_READ_API as unknown as AdminReadRpcClient | undefined;
  if (!rpc) {
    rpcError = "Control plane RPC binding not configured";
  } else {
    try {
      const candidate = await Promise.race([
        rpc.getRunDetailV1({ runId: parsedRunId.data }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5_000),
        ),
      ]);
      rpcDetail = parseRpcRunDetail(candidate);
    } catch {
      rpcError = "RPC drill-down unavailable";
    }
  }
  return { rpcDetail, rpcError, run, userEmail: identity.email };
}

export default function RunDetailRoute() {
  return <RunDetailView {...useLoaderData<typeof loader>()} embedded />;
}
