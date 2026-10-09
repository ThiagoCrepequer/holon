import { createContext } from "react-router";

import type { DashboardServices } from "./server/http-context.server.js";
export const nonceContext = createContext<string>();
/** Per-request server capabilities; the loader serializes only their public projection. */
export const viewerServicesContext = createContext<DashboardServices>({});
