import { type LoaderFunctionArgs, useLoaderData } from "react-router";

import { checkReadiness } from "../../workers/observability/readiness.js";
import { adminRequestContext } from "../server/request-context.js";
import { ReadinessView } from "../views/readiness-view.js";

export async function loader({ context }: LoaderFunctionArgs) {
  const { env, identity } = context.get(adminRequestContext);
  return { report: await checkReadiness(env), userEmail: identity.email };
}

export default function ReadinessRoute() {
  return <ReadinessView {...useLoaderData<typeof loader>()} />;
}
