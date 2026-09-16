// Canonical Tailwind form controls. They replace screen-owned form selectors
// while preserving semantic labels, focus treatment, and dense desktop sizing.
// Field and PropertyRow publish the accessible name, the hint/error description
// and the invalid state through context, so a control keeps its own ref and
// props instead of being cloned, and a caller's own aria-describedby is added
// to rather than replaced.
import type {
  AriaAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { createContext, forwardRef, useContext, useId } from "react";

export type FieldValidation = {
  tone: "warning" | "danger";
  message: ReactNode;
};

type FieldDescription = {
  labelledBy?: string;
  describedBy?: string;
  invalid: boolean;
};

const FieldDescriptionContext = createContext<FieldDescription | null>(null);

type LabelledProps = Pick<
  AriaAttributes,
  "aria-describedby" | "aria-invalid" | "aria-labelledby"
> & { "aria-label"?: string };

// Merge the owning field's name/description/invalid state into a control's own
// attributes. Caller-provided values always win; descriptions are appended.
function useFieldAria(props: LabelledProps): LabelledProps {
  const field = useContext(FieldDescriptionContext);
  if (!field) return {};
  const describedBy = [props["aria-describedby"], field.describedBy]
    .filter(Boolean)
    .join(" ");
  const named =
    props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;
  return {
    "aria-labelledby": named ? undefined : field.labelledBy,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid ? true : undefined),
  };
}

export function FieldValidationMessage({
  id,
  validation,
}: {
  id?: string;
  validation: FieldValidation;
}) {
  return (
    <span
      id={id}
      data-tone={validation.tone}
      className="tw:min-w-0 tw:[overflow-wrap:anywhere] tw:text-xs tw:font-normal tw:text-warning tw:data-[tone=danger]:text-danger"
      role={validation.tone === "danger" ? "alert" : "status"}
    >
      {validation.message}
    </span>
  );
}

function useFieldDescription(
  hint: ReactNode,
  validation: FieldValidation | undefined,
) {
  const base = useId().replace(/:/g, "");
  const hintId = hint ? `${base}-hint` : undefined;
  const validationId = validation ? `${base}-validation` : undefined;
  return {
    labelId: `${base}-label`,
    hintId,
    validationId,
    describedBy: [hintId, validationId].filter(Boolean).join(" ") || undefined,
    invalid: validation?.tone === "danger",
  };
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
  const { labelId, hintId, validationId, describedBy, invalid } =
    useFieldDescription(hint, validation);
  return (
    <label className="tw:grid tw:min-w-0 tw:gap-1.5 tw:text-sm tw:font-medium tw:text-muted-foreground tw:[&>input]:w-full tw:[&>select]:w-full tw:[&>textarea]:w-full">
      <span className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1 tw:[overflow-wrap:anywhere]">
        <span id={labelId}>{label}</span>
        {hint ? <span id={hintId}>{hint}</span> : null}
      </span>
      <FieldDescriptionContext
        value={{ labelledBy: labelId, describedBy, invalid }}
      >
        {children}
      </FieldDescriptionContext>
      {validation ? (
        <FieldValidationMessage id={validationId} validation={validation} />
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
  const { labelId, hintId, validationId, describedBy, invalid } =
    useFieldDescription(hint, validation);
  return (
    <div className="tw:grid tw:min-h-control-md tw:min-w-0 tw:grid-cols-[100px_minmax(0,1fr)] tw:items-start tw:gap-x-3 tw:gap-y-1.5 tw:@max-[560px]:grid-cols-1">
      <div className="tw:inline-flex tw:min-h-control-md tw:min-w-0 tw:items-center tw:gap-1 tw:text-sm tw:text-foreground tw:[overflow-wrap:anywhere] tw:@max-[560px]:min-h-0">
        <label id={labelId} htmlFor={htmlFor}>
          {label}
        </label>
        {hint ? <span id={hintId}>{hint}</span> : null}
      </div>
      <div className="tw:grid tw:min-w-0 tw:gap-1.5 tw:[&>input]:w-full tw:[&>select]:w-full tw:[&>textarea]:w-full">
        <FieldDescriptionContext
          value={{
            labelledBy: htmlFor ? undefined : labelId,
            describedBy,
            invalid,
          }}
        >
          {children}
        </FieldDescriptionContext>
        {validation ? (
          <FieldValidationMessage id={validationId} validation={validation} />
        ) : null}
      </div>
    </div>
  );
}

// A single control inside a row that carries more than one control, or a group
// whose message cannot travel on the surrounding Field. It adds its message to
// the description the owning row already publishes instead of replacing it.
export function ValidatedControl({
  validation,
  children,
}: {
  validation?: FieldValidation;
  children: ReactNode;
}) {
  const outer = useContext(FieldDescriptionContext);
  const base = useId().replace(/:/g, "");
  const validationId = validation ? `${base}-validation` : undefined;
  return (
    <>
      <FieldDescriptionContext
        value={{
          labelledBy: outer?.labelledBy,
          describedBy:
            [outer?.describedBy, validationId].filter(Boolean).join(" ") ||
            undefined,
          invalid: Boolean(outer?.invalid) || validation?.tone === "danger",
        }}
      >
        {children}
      </FieldDescriptionContext>
      {validation ? (
        <FieldValidationMessage id={validationId} validation={validation} />
      ) : null}
    </>
  );
}

export const TextInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
    density?: "default" | "compact" | "xs";
    monospace?: boolean;
  }
>(function TextInput({ density = "default", monospace = false, ...props }, ref) {
  const fieldAria = useFieldAria(props);
  return (
    <input
      ref={ref}
      data-density={density}
      data-monospace={monospace}
      data-search={props.type === "search" || undefined}
      className="tw:[--ds-control-local-size:var(--ds-control-lg)] tw:data-[density=compact]:[--ds-control-local-size:var(--ds-control-md)] tw:data-[density=xs]:[--ds-control-local-size:var(--ds-control-sm)] tw:h-control-lg tw:min-h-control-lg tw:w-full tw:min-w-0 tw:max-w-full tw:rounded-sm tw:border tw:border-input tw:bg-background tw:px-3 tw:font-sans tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:data-[density=compact]:h-control-md tw:data-[density=compact]:min-h-control-md tw:data-[density=xs]:h-control-sm tw:data-[density=xs]:min-h-control-sm tw:data-[density=xs]:px-2 tw:data-[density=compact]:px-2 tw:data-[monospace=true]:font-mono tw:data-[search=true]:rounded-none tw:placeholder:text-muted-foreground tw:focus:border-ring tw:focus:ring-2 tw:focus:ring-ring/30 tw:disabled:cursor-default tw:disabled:opacity-50"
      {...props}
      {...fieldAria}
    />
  );
});

export const SelectInput = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
    density?: "default" | "compact" | "xs";
  }
>(function SelectInput(
  { children, density = "default", ...props },
  ref,
) {
  const fieldAria = useFieldAria(props);
  return (
    <select
      ref={ref}
      data-density={density}
      className="tw:[--ds-control-local-size:var(--ds-control-lg)] tw:data-[density=compact]:[--ds-control-local-size:var(--ds-control-md)] tw:data-[density=xs]:[--ds-control-local-size:var(--ds-control-sm)] tw:h-control-lg tw:min-h-control-lg tw:w-full tw:min-w-0 tw:max-w-full tw:rounded-sm tw:border tw:border-input tw:bg-background tw:px-3 tw:font-sans tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:data-[density=compact]:h-control-md tw:data-[density=compact]:min-h-control-md tw:data-[density=xs]:h-control-sm tw:data-[density=xs]:min-h-control-sm tw:data-[density=xs]:px-2 tw:data-[density=compact]:px-2 tw:focus:border-ring tw:focus:ring-2 tw:focus:ring-ring/30 tw:disabled:cursor-default tw:disabled:opacity-50"
      {...props}
      {...fieldAria}
    >
      {children}
    </select>
  );
});

export const InlineSelect = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">
>(function InlineSelect({ children, ...props }, ref) {
  const fieldAria = useFieldAria(props);
  return (
    <select
      ref={ref}
      className="tw:[--ds-control-local-size:var(--ds-control-sm)] tw:block tw:h-control-sm tw:min-h-control-sm tw:min-w-0 tw:max-w-full tw:cursor-pointer tw:appearance-none tw:truncate tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-sm tw:font-medium tw:text-info tw:outline-none tw:focus-visible:rounded-xs tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:disabled:cursor-default tw:disabled:text-muted-foreground"
      {...props}
      {...fieldAria}
    >
      {children}
    </select>
  );
});

export const TextAreaInput = forwardRef<
  HTMLTextAreaElement,
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">
>(function TextAreaInput(props, ref) {
  const fieldAria = useFieldAria(props);
  return (
    <textarea
      ref={ref}
      className="tw:min-h-24 tw:w-full tw:min-w-0 tw:max-w-full tw:resize-y tw:rounded-sm tw:border tw:border-input tw:bg-background tw:px-3 tw:py-2 tw:font-mono tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:placeholder:text-muted-foreground tw:focus:border-ring tw:focus:ring-2 tw:focus:ring-ring/30 tw:disabled:cursor-default tw:disabled:opacity-50"
      {...props}
      {...fieldAria}
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
        className="tw:size-4 tw:shrink-0 tw:rounded-xs tw:accent-primary tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:focus-visible:ring-offset-2 tw:focus-visible:ring-offset-background"
        {...props}
        ref={(node) => {
          if (node) node.indeterminate = indeterminate;
        }}
        aria-checked={
          indeterminate ? "mixed" : props["aria-checked"]
        }
      />
      <span className="tw:inline-flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2 tw:[overflow-wrap:anywhere]">
        {label}
      </span>
    </label>
  );
}
