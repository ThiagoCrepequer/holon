import { dashboardIdSchema } from "@holon/contracts/dashboard";
import { useLingui } from "@lingui/react";
import { useParams, useRouteLoaderData } from "react-router";

import { InvitationControls } from "../../features/collaboration/public.js";
import { SignIn } from "../../features/sessions/public.js";
import type { loader } from "../../root.js";
export default function Invitation() {
  const { i18n } = useLingui();
  const { id } = useParams();
  const data = useRouteLoaderData<typeof loader>("root")!;
  const parsed = dashboardIdSchema.safeParse(id);
  return (
    <main className="holon-welcome holon-invitation">
      <h1>
        {i18n._({ id: "invitation.title", message: "Workspace invitation" })}
      </h1>
      <p>
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
      <p>
        <a href="/">
          {i18n._({ id: "invitation.home", message: "Return to Holon" })}
        </a>
      </p>
    </main>
  );
}
