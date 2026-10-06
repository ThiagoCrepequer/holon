import { Settings2, X, ArrowRight } from "lucide-react";

const icons = { settings: Settings2, close: X, arrowRight: ArrowRight };
export function Icon({
  name,
  label,
}: {
  name: keyof typeof icons;
  label?: string;
}) {
  const Component = icons[name];
  return (
    <Component
      width={20}
      height={20}
      strokeWidth={1.75}
      aria-hidden={label === undefined || undefined}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      focusable="false"
    />
  );
}
