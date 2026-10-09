import { index, route, type RouteConfig } from "@react-router/dev/routes";
export default [
  index("routes/welcome/route.tsx"),
  route("invitations/:id", "routes/invitation/route.tsx"),
  route("reviews/:resource?", "routes/reviews/route.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
