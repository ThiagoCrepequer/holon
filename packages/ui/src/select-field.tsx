import type { ComponentPropsWithRef } from "react";

import { cn } from "./classes.js";
import { FieldFrame, fieldDescription, useFieldId } from "./field.js";
import { Icon } from "./icons.js";
export interface SelectFieldProps extends ComponentPropsWithRef<"select"> {
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
  const fieldId = useFieldId(id);
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
    >
      <div className="relative min-w-0">
        <select
          {...props}
          id={fieldId}
          data-slot="native-select"
          className={cn(
            "min-h-control w-full min-w-0 appearance-none rounded-md border border-input bg-card py-2 pr-10 pl-3 text-body text-foreground transition-[border-color] duration-(--holon-motion-fast) enabled:hover:border-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:bg-disabled disabled:text-disabled-foreground aria-invalid:border-danger-foreground aria-invalid:enabled:hover:border-danger-foreground motion-reduce:transition-none forced-colors:appearance-auto",
            className,
          )}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={fieldDescription(
            fieldId,
            hint,
            error,
            props["aria-describedby"],
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-secondary forced-colors:hidden">
          <Icon name="chevronDown" />
        </span>
      </div>
    </FieldFrame>
  );
}
