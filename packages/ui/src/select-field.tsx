import { useId, type SelectHTMLAttributes } from "react";
export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: readonly { value: string; label: string }[];
  hint?: string;
  error?: string;
}
export function SelectField({
  label,
  options,
  hint,
  error,
  id,
  className,
  ...props
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy =
    [
      props["aria-describedby"],
      hint ? `${fieldId}-hint` : undefined,
      error ? `${fieldId}-error` : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="holon-field">
      <label htmlFor={fieldId}>{label}</label>
      <select
        {...props}
        id={fieldId}
        className={className}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${fieldId}-hint`} className="holon-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} className="holon-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
