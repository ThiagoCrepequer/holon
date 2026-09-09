import { Select as BaseSelect } from "@base-ui/react";
import * as React from "react";

import { cn } from "../../utils/cn.js";

export const Select = BaseSelect.Root;
export const SelectPortal = BaseSelect.Portal;
export const SelectGroup = BaseSelect.Group;
export const SelectList = BaseSelect.List;

export const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--text-primary)] shadow-xs transition-colors select-none",
      "hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)]/50 active:bg-[var(--surface-hover)]/50",
      "outline-none focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]",
      "focus-visible:outline-none focus-visible:border-[var(--accent)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--surface-muted)]",
      className,
    )}
    {...props}
  >
    {children}
  </BaseSelect.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectValue = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Value>
>(({ className, ...props }, ref) => (
  <BaseSelect.Value
    ref={ref}
    className={cn(
      "truncate text-left text-[var(--text-primary)] data-[placeholder]:text-[var(--text-disabled)]",
      className,
    )}
    {...props}
  />
));
SelectValue.displayName = "SelectValue";

export const SelectIcon = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Icon>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Icon
    ref={ref}
    className={cn("text-[var(--text-muted)] shrink-0", className)}
    {...props}
  >
    {children ?? (
      <svg
        aria-hidden="true"
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    )}
  </BaseSelect.Icon>
));
SelectIcon.displayName = "SelectIcon";

export const SelectPositioner = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Positioner>
>(({ className, ...props }, ref) => (
  <BaseSelect.Positioner
    ref={ref}
    className={cn("z-50 outline-none", className)}
    {...props}
  />
));
SelectPositioner.displayName = "SelectPositioner";

export const SelectPopup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Popup>
>(({ className, ...props }, ref) => (
  <BaseSelect.Popup
    ref={ref}
    className={cn(
      "min-w-[var(--anchor-width)] max-h-60 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text-primary)] shadow-lg outline-none",
      "transition-all data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
      className,
    )}
    {...props}
  />
));
SelectPopup.displayName = "SelectPopup";

export const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Item>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-2.5 pr-7 text-xs text-[var(--text-primary)] outline-none transition-colors",
      "data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--text-primary)]",
      "data-[selected]:font-medium data-[selected]:text-[var(--text-primary)]",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      className,
    )}
    {...props}
  >
    {children}
  </BaseSelect.Item>
));
SelectItem.displayName = "SelectItem";

export const SelectItemText = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.ItemText>
>(({ className, ...props }, ref) => (
  <BaseSelect.ItemText
    ref={ref}
    className={cn("truncate", className)}
    {...props}
  />
));
SelectItemText.displayName = "SelectItemText";

export const SelectItemIndicator = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.ItemIndicator>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.ItemIndicator
    ref={ref}
    className={cn(
      "absolute right-2 flex items-center justify-center text-[var(--text-primary)]",
      className,
    )}
    {...props}
  >
    {children ?? (
      <svg
        aria-hidden="true"
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          d="M5 13l4 4L19 7"
        />
      </svg>
    )}
  </BaseSelect.ItemIndicator>
));
SelectItemIndicator.displayName = "SelectItemIndicator";

export const SelectGroupLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.GroupLabel>
>(({ className, ...props }, ref) => (
  <BaseSelect.GroupLabel
    ref={ref}
    className={cn(
      "py-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-disabled)]",
      className,
    )}
    {...props}
  />
));
SelectGroupLabel.displayName = "SelectGroupLabel";

export const SelectSeparator = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Separator>
>(({ className, ...props }, ref) => (
  <BaseSelect.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-[var(--surface-hover)]", className)}
    {...props}
  />
));
SelectSeparator.displayName = "SelectSeparator";

export interface SelectFieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps {
  id?: string;
  name?: string;
  label?: string;
  options: SelectFieldOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  placeholder?: string;
  className?: string;
  containerClassName?: string;
  autoSubmit?: boolean;
}

export const SelectField = React.forwardRef<
  HTMLButtonElement,
  SelectFieldProps
>(
  (
    {
      id,
      name,
      label,
      options,
      value,
      defaultValue,
      onValueChange,
      disabled,
      required,
      error,
      placeholder,
      className,
      containerClassName,
      autoSubmit,
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    const errorId = `${selectId}-error`;
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);

    React.useImperativeHandle(
      ref,
      () => triggerRef.current as HTMLButtonElement,
    );

    const labelMap = React.useMemo(() => {
      const map = new Map<string, string>();
      for (const opt of options) {
        map.set(opt.value, opt.label);
      }
      return map;
    }, [options]);

    const initialDefaultValue =
      defaultValue !== undefined
        ? defaultValue
        : placeholder !== undefined
          ? undefined
          : options[0]?.value;

    const handleValueChange = React.useCallback(
      (val: string | null) => {
        onValueChange?.(val);
        if (autoSubmit) {
          const form = triggerRef.current?.closest("form");
          form?.requestSubmit();
        }
      },
      [autoSubmit, onValueChange],
    );

    return (
      <div className={cn("relative inline-block w-full", containerClassName)}>
        {label && (
          <label
            htmlFor={selectId}
            className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1"
          >
            {label}
          </label>
        )}
        <Select
          id={selectId}
          name={name}
          value={value}
          defaultValue={initialDefaultValue}
          onValueChange={handleValueChange}
          disabled={disabled}
          required={required}
        >
          <SelectTrigger
            ref={triggerRef}
            id={selectId}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              "w-full h-9",
              error &&
                "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger-bg)] focus-visible:border-[var(--danger)]",
              className,
            )}
          >
            <SelectValue placeholder={placeholder ?? options[0]?.label}>
              {(selectedVal: unknown) => {
                const key =
                  typeof selectedVal === "string"
                    ? selectedVal
                    : typeof selectedVal === "number"
                      ? `${selectedVal}`
                      : "";
                return (
                  labelMap.get(key) ??
                  (key || (placeholder ?? options[0]?.label))
                );
              }}
            </SelectValue>
            <SelectIcon />
          </SelectTrigger>
          <SelectPortal>
            <SelectPositioner sideOffset={4} className="z-50">
              <SelectPopup className="min-w-[var(--anchor-width)] max-h-60 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text-primary)] shadow-lg outline-none">
                {options.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    <SelectItemText>{option.label}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectPopup>
            </SelectPositioner>
          </SelectPortal>
        </Select>
        {error && (
          <p
            id={errorId}
            className="mt-1 text-[11px] text-[var(--danger-text)] font-medium"
          >
            {error}
          </p>
        )}
      </div>
    );
  },
);
SelectField.displayName = "SelectField";
