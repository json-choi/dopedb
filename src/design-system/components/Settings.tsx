// Canonical flat group for dense preference and policy controls, plus the
// shared Settings section page layout and checkbox preference row. Settings
// screens provide their own row grids while these primitives own the shared
// divider, heading and width rhythm without adding nested card surfaces.
import type { ReactNode } from "react";
import { CheckboxField } from "./FormControls";

export function SettingsGroup({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="tw:grid tw:content-start tw:gap-0 tw:border-t tw:border-border-subtle tw:py-2">
      <h3 className="tw:mt-0 tw:mb-1">{title}</h3>
      {children}
    </section>
  );
}

/** Shared width, padding and vertical rhythm of one Settings section body. */
export function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <div className="tw:grid tw:w-full tw:max-w-[800px] tw:content-start tw:gap-4 tw:p-4 tw:@max-[700px]:p-0">
      {children}
    </div>
  );
}

/** One checkbox preference: label, optional explanation, optional extra detail. */
export function SettingsToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="tw:grid tw:min-w-0 tw:gap-1 tw:py-2">
      <CheckboxField
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        label={label}
      />
      {description ? (
        <p className="tw:m-0 tw:pl-6 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}
