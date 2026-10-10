import { AccountOverview } from "../../features/account/public.js";
import type { Route } from "./+types/route";
export function meta({ matches }: Route.MetaArgs) {
  return [
    {
      title:
        matches[0]?.loaderData?.locale === "pt-BR"
          ? "Conta e workspaces · Holon"
          : "Account and workspaces · Holon",
    },
  ];
}
export default function Account() {
  return <AccountOverview account />;
}
