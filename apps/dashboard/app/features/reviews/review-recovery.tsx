import { useLingui } from "@lingui/react";
import { Link, useLocation } from "react-router";

import { SignIn } from "../sessions/public.js";
import { reviewReturnDestination } from "./review-return.js";

export function ReviewReturnLink({
  destination,
}: {
  destination: string | null;
}) {
  const { i18n } = useLingui();
  const target = reviewReturnDestination(destination);
  return target ? (
    <Link to={target}>
      {i18n._({ id: "reviews.back", message: "Back to reviews" })}
    </Link>
  ) : null;
}
export function ReviewRecovery({ status = 503 }: { status?: number }) {
  const { i18n } = useLingui(),
    location = useLocation();
  const destination = location.pathname + location.search;
  return (
    <section
      className="grid gap-4 rounded-lg border border-border bg-card p-6"
      aria-label={i18n._({
        id: "reviews.unavailable",
        message: "Review data unavailable. Check your access and try again.",
      })}
    >
      <p role="alert">
        {i18n._({
          id: "reviews.unavailable",
          message: "Review data unavailable. Check your access and try again.",
        })}
      </p>
      {(status === 401 || status === 403) && (
        <SignIn reconnect={status === 401} />
      )}
      <Link
        to={`/account?${new URLSearchParams({ lang: i18n.locale, returnTo: destination })}`}
      >
        {i18n._({ id: "account.title", message: "Account and workspaces" })}
      </Link>
      {status !== 401 && status !== 403 && (
        <Link reloadDocument to={destination}>
          {i18n._({ id: "reviews.refresh", message: "Refresh" })}
        </Link>
      )}
    </section>
  );
}
