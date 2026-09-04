import {
  data,
  Outlet,
  type LoaderFunctionArgs,
  useLoaderData,
} from "react-router";

import { D1AdminStorage } from "../../workers/d1-adapter.js";
import { parseCursorKeyring } from "../../workers/security/keyring.js";
import { adminRequestContext } from "../server/request-context.js";
import { parseRunFilters } from "../server/run-filters.js";
import { RunsView } from "../views/runs-view.js";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env, identity } = context.get(adminRequestContext);
  let filters;
  try {
    filters = parseRunFilters(new URL(request.url).searchParams);
  } catch {
    throw data("Invalid run filters", { status: 400 });
  }
  const storage = new D1AdminStorage(env.DB);
  let result;
  try {
    result = await storage.listRuns(
      filters,
      parseCursorKeyring(env.ADMIN_CURSOR_HMAC_KEYS),
    );
  } catch {
    throw data("Invalid or expired cursor", { status: 400 });
  }
  return { filters, result, userEmail: identity.email };
}

export default function RunsRoute() {
  const { filters, result, userEmail } = useLoaderData<typeof loader>();
  return (
    <>
      <RunsView
        userEmail={userEmail}
        runs={result.runs}
        nextCursor={result.nextCursor}
        searchQuery={filters.searchQuery}
        period={filters.period}
        terminalState={filters.terminalState}
        verdict={filters.verdict}
        repositoryId={filters.repositoryId}
        order={filters.order}
        pageSize={filters.pageSize}
      />
      <Outlet />
    </>
  );
}
