import { useLingui } from "@lingui/react";
import { data } from "react-router";

// Match unknown URLs explicitly so locale/nonce loaders and the HTML layout run.
export function loader() {
  return data(null, { status: 404 });
}
export default function NotFound() {
  const { i18n } = useLingui();
  return (
    <main className="holon-welcome">
      <p role="alert">
        {i18n._({ id: "error.page", message: "Page unavailable" })}
      </p>
    </main>
  );
}
