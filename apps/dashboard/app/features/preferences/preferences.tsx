import type { DashboardLocale } from "@holon/contracts/dashboard";
import type { PersonalPreferences } from "@holon/contracts/dashboard-preferences";
import { Button } from "@holon/ui/button";
import { SelectField } from "@holon/ui/select-field";
import { useLingui } from "@lingui/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import {
  inferDeviceTimezone,
  preferenceFields,
  preferencesCommand,
} from "./preferences-form.js";

type Props = {
  sessionId: string | null;
  csrf: string | null;
  preferences: PersonalPreferences;
  locale: DashboardLocale;
  onSaved: () => void;
  onSessionLost: (sessionId: string) => void;
};

export function PreferencesForm({
  sessionId,
  csrf,
  preferences,
  locale,
  onSaved,
  onSessionLost,
}: Props) {
  const { i18n } = useLingui();
  const [parameters, setParameters] = useSearchParams();
  const [language, setLanguage] = useState<string>(
    preferences.locale ?? locale,
  );
  const [timezone, setTimezone] = useState(preferences.timezone ?? "UTC");
  const [deviceZones, setDeviceZones] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">(
    "idle",
  );
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    // ICU catalogs can differ between Workerd and browsers: enumerate after hydration.
    setDeviceZones(Intl.supportedValuesOf("timeZone"));
  }, []);
  useEffect(() => {
    if (preferences.timezone === null) setTimezone(inferDeviceTimezone());
  }, [preferences.timezone]);
  const zones = Array.from(new Set(["UTC", timezone, ...deviceZones])).map(
    (value) => ({ value, label: value }),
  );
  const savedAccount = sessionId !== null && csrf !== null;
  return (
    <form
      className="grid gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!savedAccount || request.current) return;
        const input = preferenceFields({ language, timezone });
        if (!input) {
          setStatus("failed");
          return;
        }
        const pending = new AbortController();
        request.current = pending;
        setStatus("saving");
        const result = await preferencesCommand(input, csrf, pending.signal);
        if (!mounted.current || pending.signal.aborted) return;
        request.current = null;
        if (result.status === "session-lost") {
          onSessionLost(sessionId);
          return;
        }
        if (result.status === "unconfirmed") {
          setStatus("failed");
          return;
        }
        setStatus("saved");
        onSaved();
      }}
    >
      <SelectField
        label={i18n._({ id: "preferences.language", message: "Language" })}
        disabled={status === "saving"}
        value={savedAccount ? language : i18n.locale}
        options={[
          { value: "en", label: "English" },
          { value: "pt-BR", label: "Português (Brasil)" },
        ]}
        onChange={(event) => {
          if (savedAccount) {
            setLanguage(event.target.value);
            setStatus("idle");
          } else {
            const next = new URLSearchParams(parameters);
            next.set("lang", event.target.value);
            setParameters(next, { preventScrollReset: true });
          }
        }}
      />
      {savedAccount && (
        <SelectField
          label={i18n._({ id: "preferences.timezone", message: "Time zone" })}
          hint={i18n._({
            id: "preferences.personal",
            message: "Saved to your account across devices.",
          })}
          disabled={status === "saving"}
          value={timezone}
          options={zones}
          onChange={(event) => {
            setTimezone(event.target.value);
            setStatus("idle");
          }}
        />
      )}
      <SelectField
        label={i18n._({ id: "preferences.theme", message: "Theme" })}
        value={parameters.get("theme") === "dark" ? "dark" : "light"}
        options={[
          {
            value: "light",
            label: i18n._({ id: "theme.light", message: "Light" }),
          },
          {
            value: "dark",
            label: i18n._({ id: "theme.dark", message: "Dark" }),
          },
        ]}
        onChange={(event) => {
          const next = new URLSearchParams(parameters);
          next.set("theme", event.target.value);
          setParameters(next, { preventScrollReset: true });
        }}
      />
      {savedAccount && (
        <>
          <Button
            type="submit"
            aria-disabled={status === "saving"}
            aria-busy={status === "saving"}
          >
            {status === "saving"
              ? i18n._({ id: "preferences.saving", message: "Saving…" })
              : i18n._({ id: "preferences.save", message: "Save preferences" })}
          </Button>
          {status === "saved" && (
            <p role="status">
              {i18n._({
                id: "preferences.saved",
                message: "Preferences saved.",
              })}
            </p>
          )}
          {status === "failed" && (
            <p role="alert">
              {i18n._({
                id: "preferences.failed",
                message: "Unable to confirm the save. Please try again.",
              })}
            </p>
          )}
        </>
      )}
    </form>
  );
}
