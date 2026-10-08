import { BrandMark } from "@holon/ui/brand";
import { Button } from "@holon/ui/button";
import { Dialog } from "@holon/ui/dialog";
import { Icon } from "@holon/ui/icons";
import { SelectField } from "@holon/ui/select-field";
import { useLingui } from "@lingui/react";
import { useState } from "react";
import { useSearchParams } from "react-router";
export function meta() {
  return [{ title: "Holon" }];
}
export default function Welcome() {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [parameters, setParameters] = useSearchParams();
  const heading = i18n._({
    id: "welcome.heading",
    message: "Your reviews, in context.",
  });
  const preferences = i18n._({
    id: "preferences.title",
    message: "Preferences",
  });
  return (
    <div className="holon-welcome">
      <header>
        <div className="holon-wordmark">
          <BrandMark decorative />
          holon
        </div>
        <Button
          variant="quiet"
          aria-label={preferences}
          onClick={() => setOpen(true)}
        >
          <Icon name="settings" />
        </Button>
      </header>
      <main>
        <h1>{heading}</h1>
        <p>
          {i18n._({
            id: "welcome.description",
            message:
              "Understand every change with clarity and the context that matters.",
          })}
        </p>
      </main>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={preferences}
        description={i18n._({
          id: "preferences.description",
          message: "Choose how you read Holon.",
        })}
        closeLabel={i18n._({
          id: "preferences.close",
          message: "Close preferences",
        })}
      >
        <SelectField
          label={i18n._({ id: "preferences.language", message: "Language" })}
          value={i18n.locale}
          options={[
            { value: "en", label: "English" },
            { value: "pt-BR", label: "Português (Brasil)" },
          ]}
          onChange={(event) => {
            const next = new URLSearchParams(parameters);
            next.set("lang", event.target.value);
            setParameters(next, { preventScrollReset: true });
          }}
        />
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
      </Dialog>
    </div>
  );
}
