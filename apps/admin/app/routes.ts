import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/dashboard.tsx"),
  route("runs", "routes/runs.tsx", [route(":runId", "routes/run-detail.tsx")]),
  route("readiness", "routes/readiness.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
