import { data, type LoaderFunctionArgs, useLoaderData } from "react-router";

import { D1AdminStorage } from "../../workers/d1-adapter.js";
import { queryAnalyticsTrend } from "../../workers/observability/analytics-client.js";
import { queryQueueHealth } from "../../workers/observability/queue-metrics-client.js";
import { parseCursorKeyring } from "../../workers/security/keyring.js";
import { adminRequestContext } from "../server/request-context.js";
import { DashboardView } from "../views/dashboard-view.js";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env, identity } = context.get(adminRequestContext);
  const rawWindow = new URL(request.url).searchParams.get("window") ?? "24h";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    throw data("Invalid time window", { status: 400 });
  }
  const window: "24h" | "7d" | "30d" = rawWindow;
  const storage = new D1AdminStorage(env.DB);
  const keyring = parseCursorKeyring(env.ADMIN_CURSOR_HMAC_KEYS);
  const [summary, recentRuns, analytics, queues, watermark] = await Promise.all(
    [
      storage.getSummaryMetrics(window),
      storage.listRuns({ period: window, pageSize: 20 }, keyring),
      queryAnalyticsTrend(window, {
        accountId: env.CF_ACCOUNT_ID,
        apiToken: env.CF_ANALYTICS_API_TOKEN,
      }),
      queryQueueHealth({
        accountId: env.CF_ACCOUNT_ID,
        apiToken: env.CF_QUEUES_READ_TOKEN,
        queueId: env.PROJECTION_QUEUE_ID,
        dlqId: env.PROJECTION_DLQ_ID,
      }),
      storage.getProjectionWatermark(),
    ],
  );
  const degradedServices: string[] = [];
  if (analytics.status !== "ok") degradedServices.push("Analytics Engine");
  if (queues.status !== "ok" || queues.data.isDegraded) {
    degradedServices.push("Queue Pipeline");
  }
  return {
    analyticsTrend: analytics.status === "ok" ? analytics.data : null,
    degradedServices,
    queueHealth: queues.status === "ok" ? queues.data : null,
    recentRuns: recentRuns.runs.slice(0, 10),
    summary,
    userEmail: identity.email,
    watermark,
    window,
  };
}

export default function DashboardRoute() {
  return <DashboardView {...useLoaderData<typeof loader>()} />;
}
