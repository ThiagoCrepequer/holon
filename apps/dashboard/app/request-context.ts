import { createContext } from "react-router";

import type { ViewerServices } from "./server/viewer.server.js";
export const nonceContext = createContext<string>();
/** Per-request server capabilities; the loader serializes only their public projection. */
export const viewerServicesContext = createContext<ViewerServices>({});
