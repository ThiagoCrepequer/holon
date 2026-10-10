import { dashboardIdSchema } from "@holon/contracts/dashboard";
import { Card } from "@holon/ui/card";
import { Icon } from "@holon/ui/icons";
import { useLingui } from "@lingui/react";
import { useParams, useRouteLoaderData } from "react-router";

import { InvitationControls } from "../../features/collaboration/public.js";
import { SignIn } from "../../features/sessions/public.js";
import type { loader } from "../../root.js";
import type { Route } from "./+types/route";
export function meta({ matches }: Route.MetaArgs) {
  return [
    {
      title:
        matches[0]?.loaderData?.locale === "pt-BR"
          ? "Convite de workspace · Holon"
          : "Workspace invitation · Holon",
    },
  ];
}
export default function Invitation() {
  const { i18n } = useLingui();
  const { id } = useParams();
  const data = useRouteLoaderData<typeof loader>("root")!;
  const parsed = dashboardIdSchema.safeParse(id);
  return (
    <main className="mx-auto max-w-reading px-5 py-8">
      <Card className="grid gap-6">
        <span className="flex size-12 items-center justify-center rounded-lg bg-selected text-selected-foreground">
          <Icon name="mail" />
        </span>
        <h1 className="text-page leading-title font-semibold tracking-tight">
          {i18n._({ id: "invitation.title", message: "Workspace invitation" })}
        </h1>
        <p className="text-secondary">
          {i18n._({
            id: "invitation.privacy",
            message:
              "Opening this link changes nothing and reveals no workspace details. Sign in and confirm your currently verified GitHub email to accept.",
          })}
        </p>
        {parsed.success && data.viewer.status === "authenticated" ? (
          <InvitationControls
            key={data.viewer.sessionId}
            id={parsed.data}
            csrf={data.viewer.csrf}
          />
        ) : (
          <SignIn />
        )}
        <p className="border-t border-border pt-4 text-small font-medium">
          <a href="/">
            {i18n._({ id: "invitation.home", message: "Return to Holon" })}
          </a>
        </p>
      </Card>
    </main>
  );
}
