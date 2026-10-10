import type { ComponentPropsWithRef } from "react";

import {
  FieldFrame,
  fieldDescription,
  useFieldId,
  type FieldDescription,
} from "./field.js";
import { Input } from "./input.js";

export function InputField({
  label,
  hint,
  error,
  id,
  ...props
}: ComponentPropsWithRef<"input"> & FieldDescription) {
  const fieldId = useFieldId(id);
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
    >
      <Input
        {...props}
        id={fieldId}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={fieldDescription(
          fieldId,
          hint,
          error,
          props["aria-describedby"],
        )}
      />
    </FieldFrame>
  );
}
