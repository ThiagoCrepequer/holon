import {
  createRequestHandler,
  RouterContextProvider,
  type ServerBuild,
} from "react-router";

import { nonceContext } from "../app/request-context.js";
import { createDashboardHandler } from "../app/server/http-app.server.js";
const render = createRequestHandler(
  async () => {
    const {
      basename,
      allowedActionOrigins,
      unstable_getCriticalCss,
      ...build
    } = await import("virtual:react-router/server-build");
    // Generated module exports use T | undefined for optional properties.
    // Preserve their absence without weakening exactOptionalPropertyTypes.
    return {
      ...build,
      ...(basename === undefined ? {} : { basename }),
      ...(allowedActionOrigins === undefined ? {} : { allowedActionOrigins }),
      ...(unstable_getCriticalCss === undefined
        ? {}
        : { unstable_getCriticalCss }),
    } satisfies ServerBuild;
  },
  import.meta.env.MODE,
);
const handle = createDashboardHandler((request, requestNonce) => {
  const context = new RouterContextProvider();
  context.set(nonceContext, requestNonce);
  return render(request, context);
});
export default {
  fetch(request: Request, environment: Env) {
    return handle(request, environment.APP_ORIGIN);
  },
};
