// Canonical Tailwind form controls. They replace screen-owned form selectors
// while preserving semantic labels, focus treatment, and dense desktop sizing.
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef } from "react";

export type FieldValidation = {
  tone: "warning" | "danger";
  message: ReactNode;
};

export function FieldValidationMessage({
  validation,
}: {
  validation: FieldValidation;
}) {
  return (
    <span
      data-tone={validation.tone}
      className="tw:text-xs tw:font-normal tw:text-warning tw:data-[tone=danger]:text-danger"
      role={validation.tone === "danger" ? "alert" : "status"}
    >
      {validation.message}
    </span>
  );
}

export function Field({
  label,
  hint,
  validation,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  validation?: FieldValidation;
  children: ReactNode;
}) {
  return (
    <label className="tw:grid tw:min-w-0 tw:gap-1.5 tw:text-sm tw:font-medium tw:text-muted-foreground tw:[&>input]:w-full tw:[&>select]:w-full tw:[&>textarea]:w-full">
      <span className="tw:inline-flex tw:items-center tw:gap-1">
        {label}
        {hint}
      </span>
      {children}
      {validation ? (
        <FieldValidationMessage validation={validation} />
      ) : null}
    </label>
  );
}

export function PropertyRow({
  label,
  htmlFor,
  hint,
  validation,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  validation?: FieldValidation;
  children: ReactNode;
}) {
  return (
    <div className="tw:grid tw:min-h-control-md tw:min-w-0 tw:grid-cols-[100px_minmax(0,1fr)] tw:items-start tw:gap-x-3 tw:gap-y-1.5 tw:@max-[560px]:grid-cols-1">
      <label
        htmlFor={htmlFor}
        className="tw:inline-flex tw:min-h-control-md tw:items-center tw:gap-1 tw:text-sm tw:text-foreground tw:@max-[560px]:min-h-0"
      >
        {label}
        {hint}
      </label>
      <div className="tw:grid tw:min-w-0 tw:gap-1.5 tw:[&>input]:w-full tw:[&>select]:w-full tw:[&>textarea]:w-full">
        {children}
        {validation ? (
          <FieldValidationMessage validation={validation} />
        ) : null}
      </div>
    </div>
  );
}

export const TextInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
    density?: "default" | "compact";
    monospace?: boolean;
  }
>(function TextInput({ density = "default", monospace = false, ...props }, ref) {
  return (
    <input
      ref={ref}
      data-density={density}
      data-monospace={monospace}
      className="tw:h-control-lg tw:w-full tw:rounded-sm tw:border tw:border-input tw:bg-background tw:px-3 tw:font-sans tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:data-[density=compact]:h-control-md tw:data-[density=compact]:px-2 tw:data-[monospace=true]:font-mono tw:placeholder:text-muted-foreground tw:focus:border-ring tw:focus:ring-2 tw:focus:ring-ring/30 tw:disabled:cursor-default tw:disabled:opacity-50"
      {...props}
    />
  );
});

export const SelectInput = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
    density?: "default" | "compact";
  }
>(function SelectInput(
  { children, density = "default", ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      data-density={density}
      className="tw:h-control-lg tw:w-full tw:rounded-sm tw:border tw:border-input tw:bg-background tw:px-3 tw:font-sans tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:data-[density=compact]:h-control-md tw:data-[density=compact]:px-2 tw:focus:border-ring tw:focus:ring-2 tw:focus:ring-ring/30 tw:disabled:cursor-default tw:disabled:opacity-50"
      {...props}
    >
      {children}
    </select>
  );
});

export const InlineSelect = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">
>(function InlineSelect({ children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className="tw:block tw:h-control-sm tw:min-w-0 tw:max-w-full tw:cursor-pointer tw:appearance-none tw:truncate tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-sm tw:font-medium tw:text-info tw:outline-none tw:focus-visible:rounded-xs tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:disabled:cursor-default tw:disabled:text-muted-foreground"
      {...props}
    >
      {children}
    </select>
  );
});

export const TextAreaInput = forwardRef<
  HTMLTextAreaElement,
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">
>(function TextAreaInput(props, ref) {
  return (
    <textarea
      ref={ref}
      className="tw:min-h-24 tw:w-full tw:resize-y tw:rounded-sm tw:border tw:border-input tw:bg-background tw:px-3 tw:py-2 tw:font-mono tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:placeholder:text-muted-foreground tw:focus:border-ring tw:focus:ring-2 tw:focus:ring-ring/30 tw:disabled:cursor-default tw:disabled:opacity-50"
      {...props}
    />
  );
});

export function CheckboxField({
  label,
  indeterminate = false,
  ...props
}: {
  label: ReactNode;
  indeterminate?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type">) {
  return (
    <label className="tw:inline-flex tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-2 tw:text-ui tw:text-foreground">
      <input
        type="checkbox"
        className="tw:size-4 tw:rounded-xs tw:accent-primary tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:focus-visible:ring-offset-2 tw:focus-visible:ring-offset-background"
        {...props}
        ref={(node) => {
          if (node) node.indeterminate = indeterminate;
        }}
        aria-checked={
          indeterminate ? "mixed" : props["aria-checked"]
        }
      />
      <span className="tw:inline-flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2">
        {label}
      </span>
    </label>
  );
}
