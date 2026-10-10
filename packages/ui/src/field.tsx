import { useId, type ReactNode } from "react";

export type FieldDescription = {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
};

export function useFieldId(id?: string) {
  const generated = useId();
  return id ?? generated;
}
export function fieldDescription(
  id: string,
  hint?: string,
  error?: string,
  extra?: string,
) {
  return (
    [extra, hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined
  );
}
export function FieldFrame({
  id,
  label,
  hint,
  error,
  children,
}: FieldDescription & { id: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor={id} className="text-small font-semibold">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-small text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-small text-danger-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
