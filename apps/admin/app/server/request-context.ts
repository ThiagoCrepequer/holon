import { createContext } from "react-router";

import type { AdminEnv } from "../../workers/app.js";
import type { AccessIdentity } from "../../workers/security/access-jwt.js";

export interface AdminRequestContextValue {
  readonly env: AdminEnv;
  readonly executionContext: ExecutionContext;
  readonly identity: AccessIdentity;
  readonly nonce: string;
}

export const adminRequestContext = createContext<AdminRequestContextValue>();
