import { runIdSchema } from "@holon/contracts";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DashboardView } from "../app/views/dashboard-view.js";
import { ReadinessView } from "../app/views/readiness-view.js";
import { RunDetailView } from "../app/views/run-detail-view.js";
import { RunsView } from "../app/views/runs-view.js";
import type { AdminEnv } from "./app.js";
import { D1AdminStorage } from "./d1-adapter.js";
import {
  type AnalyticsClientConfig,
  queryAnalyticsTrend,
} from "./observability/analytics-client.js";
import {
  type QueueMetricsConfig,
  queryQueueHealth,
} from "./observability/queue-metrics-client.js";
import {
  type AdminReadRpcClient,
  checkReadiness,
} from "./observability/readiness.js";
import {
  AccessAuthError,
  validateAccessJwt,
  type AccessValidationConfig,
} from "./security/access-jwt.js";
import { applySecurityHeaders, generateCspNonce } from "./security/csp.js";
import { parseCursorKeyring } from "./security/keyring.js";

const BASE_CSS = `
:root {
  --canvas: #f9fafb;
  --surface: #ffffff;
  --border: #e5e7eb;
  --focus-ring: #09090b;
  --text-primary: #09090b;
  --text-secondary: #4b5563;
  --text-muted: #6b7280;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.tabular-nums { font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;

function renderDocument(
  content: string,
  nonce: string,
  title = "Holon Console",
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style nonce="${nonce}">${BASE_CSS}</style>
</head>
<body class="bg-zinc-50 text-zinc-900 antialiased min-h-screen">
  ${content}
</body>
</html>`;
}

export async function handleConsoleRequest(
  request: Request,
  env: AdminEnv,
  _ctx: ExecutionContext,
  authConfigOverride?: AccessValidationConfig,
): Promise<Response> {
  const url = new URL(request.url);

  // Unauthenticated health check endpoint
  if (url.pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
      },
      status: 200,
    });
  }

  // Enforce read-only console: reject non-GET requests
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Console is read-only." }),
      {
        status: 405,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "private, no-store",
          allow: "GET",
        },
      },
    );
  }

  // Authenticate human session via Cloudflare Access JWT
  const authConfig: AccessValidationConfig = authConfigOverride
    ? authConfigOverride
    : {
        teamName: env.ACCESS_TEAM_NAME,
        expectedAudience: env.ACCESS_AUD,
        authorizedEmailDomain: env.AUTHORIZED_EMAIL_DOMAIN,
      };

  let userEmail: string | undefined;
  try {
    const identity = await validateAccessJwt(request, authConfig);
    userEmail = identity.email;
  } catch (err) {
    if (err instanceof AccessAuthError) {
      return err.toResponse();
    }
    throw err;
  }

  const nonce = generateCspNonce();
  const storage = new D1AdminStorage(env.DB);
  const keyring = parseCursorKeyring(env.ADMIN_CURSOR_HMAC_KEYS);

  // Route 1: Readiness probe (/readiness)
  if (url.pathname === "/readiness") {
    const report = await checkReadiness(env);
    if (request.headers.get("accept")?.includes("application/json")) {
      const resp = new Response(JSON.stringify(report, null, 2), {
        status: report.status === "degraded" ? 503 : 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
      return applySecurityHeaders(resp, nonce);
    }

    const html = renderDocument(
      renderToStaticMarkup(
        React.createElement(ReadinessView, {
          userEmail,
          report,
        }),
      ),
      nonce,
      "Readiness - Holon Console",
    );

    const resp = new Response(html, {
      status: report.status === "degraded" ? 503 : 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    return applySecurityHeaders(resp, nonce);
  }

  // Route 2: Overview / Dashboard (/)
  if (url.pathname === "/" || url.pathname === "") {
    const rawWindow = url.searchParams.get("window") ?? "24h";
    const window =
      rawWindow === "7d" || rawWindow === "30d" ? rawWindow : "24h";

    const analyticsConfig: AnalyticsClientConfig = {
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_ANALYTICS_API_TOKEN,
    };

    const queueConfig: QueueMetricsConfig = {
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_QUEUES_READ_TOKEN,
      queueId: env.PROJECTION_QUEUE_ID,
      dlqId: env.PROJECTION_DLQ_ID,
    };

    const [summary, recentRunsResult, analyticsResult, queueResult] =
      await Promise.all([
        storage.getSummaryMetrics(window),
        storage.listRuns({ period: window, pageSize: 50 }, keyring),
        queryAnalyticsTrend(window, analyticsConfig),
        queryQueueHealth(queueConfig),
      ]);

    const degradedServices: string[] = [];
    if (analyticsResult.status === "unavailable") {
      degradedServices.push("Analytics Engine");
    }
    if (
      queueResult.status === "unavailable" ||
      (queueResult.status === "ok" && queueResult.data.isDegraded)
    ) {
      degradedServices.push("Queue Pipeline");
    }

    const html = renderDocument(
      renderToStaticMarkup(
        React.createElement(DashboardView, {
          userEmail,
          window,
          summary,
          analyticsTrend:
            analyticsResult.status === "ok" ? analyticsResult.data : null,
          queueHealth: queueResult.status === "ok" ? queueResult.data : null,
          recentRuns: recentRunsResult.runs.slice(0, 10),
          degradedServices,
        }),
      ),
      nonce,
      "Overview - Holon Console",
    );

    const resp = new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    return applySecurityHeaders(resp, nonce);
  }

  // Route 3: Runs Listing (/runs)
  if (url.pathname === "/runs") {
    const q = url.searchParams.get("q") ?? "";
    const periodParam = url.searchParams.get("period") ?? "24h";
    const period =
      periodParam === "7d" || periodParam === "30d" ? periodParam : "24h";
    const rawState = url.searchParams.get("state");
    const terminalState =
      rawState === "completed" ||
      rawState === "failed_terminal" ||
      rawState === "obsolete"
        ? rawState
        : undefined;

    const rawVerdict = url.searchParams.get("verdict");
    const verdict =
      rawVerdict === "APPROVE" ||
      rawVerdict === "REQUEST_CHANGES" ||
      rawVerdict === "COMMENT"
        ? rawVerdict
        : undefined;

    const cursor = url.searchParams.get("cursor") ?? undefined;

    const listResult = await storage.listRuns(
      {
        period,
        searchQuery: q || undefined,
        terminalState,
        verdict,
        cursor,
        pageSize: 50,
      },
      keyring,
    );

    const html = renderDocument(
      renderToStaticMarkup(
        React.createElement(RunsView, {
          userEmail,
          runs: listResult.runs,
          nextCursor: listResult.nextCursor,
          currentCursor: cursor ?? null,
          searchQuery: q,
          period,
          terminalState: terminalState ?? "",
          verdict: verdict ?? "",
        }),
      ),
      nonce,
      "Runs - Holon Console",
    );

    const resp = new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    return applySecurityHeaders(resp, nonce);
  }

  // Route 4: Run Detail (/runs/:runId)
  if (url.pathname.startsWith("/runs/")) {
    const rawRunId = decodeURIComponent(url.pathname.slice("/runs/".length));
    const parseResult = runIdSchema.safeParse(rawRunId);
    if (!parseResult.success) {
      const notFoundHtml = renderDocument(
        `<div class="p-8 text-center text-xs text-rose-600">Invalid run ID format</div>`,
        nonce,
        "Not Found - Holon Console",
      );
      const resp = new Response(notFoundHtml, {
        status: 400,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      return applySecurityHeaders(resp, nonce);
    }

    const runId = parseResult.data;
    const run = await storage.getRunById(runId);
    if (!run) {
      const notFoundHtml = renderDocument(
        `<div class="p-8 text-center text-xs text-zinc-500">Run ${runId} not found</div>`,
        nonce,
        "Not Found - Holon Console",
      );
      const resp = new Response(notFoundHtml, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      return applySecurityHeaders(resp, nonce);
    }

    // Call RPC drill-down on Control Plane entrypoint
    let rpcDetail = null;
    let rpcError: string | null = null;
    const rpcClient = env.ADMIN_READ_API as unknown as
      | AdminReadRpcClient
      | undefined;
    if (rpcClient) {
      try {
        rpcDetail = await Promise.race([
          rpcClient.getRunDetailV1({ runId }),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error("RPC timeout")), 5000),
          ),
        ]);
      } catch {
        rpcError = "RPC drill-down unavailable";
      }
    } else {
      rpcError = "Control plane RPC binding not configured";
    }

    const html = renderDocument(
      renderToStaticMarkup(
        React.createElement(RunDetailView, {
          userEmail,
          run,
          rpcDetail,
          rpcError,
        }),
      ),
      nonce,
      `Run Detail ${run.run_id} - Holon Console`,
    );

    const resp = new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    return applySecurityHeaders(resp, nonce);
  }

  // Route 5: 404 Not Found
  const notFoundHtml = renderDocument(
    `<div class="p-8 text-center text-xs text-zinc-500">404 - Page not found</div>`,
    nonce,
    "Not Found - Holon Console",
  );
  const resp = new Response(notFoundHtml, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  return applySecurityHeaders(resp, nonce);
}
