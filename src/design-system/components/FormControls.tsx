// Canonical Tailwind form controls. They replace screen-owned form selectors
// while preserving semantic labels, focus treatment, and dense desktop sizing.
import type {
  AriaAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef, useId } from "react";

import { Icon } from "../../components/Icon";

export type FieldValidation = {
  tone: "warning" | "danger";
  message: ReactNode;
};

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

type ExistingFieldControlAria = Pick<
  AriaAttributes,
  "aria-describedby" | "aria-invalid"
>;

export type FieldControlBinding = {
  controlProps: (
    existing?: ExistingFieldControlAria,
  ) => ExistingFieldControlAria & { id: string };
};

type FieldChildren = ReactNode | ((binding: FieldControlBinding) => ReactNode);

function mergeIdReferences(...values: Array<string | undefined>) {
  const ids = values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []);
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.length > 0 ? uniqueIds.join(" ") : undefined;
}

function fieldControlBinding({
  controlId,
  descriptionId,
  validationId,
  validation,
}: {
  controlId: string;
  descriptionId?: string;
  validationId?: string;
  validation?: FieldValidation;
}): FieldControlBinding {
  return {
    controlProps(existing = {}) {
      return {
        id: controlId,
        "aria-describedby": mergeIdReferences(
          existing["aria-describedby"],
          descriptionId,
          validationId,
        ),
        "aria-invalid":
          validation?.tone === "danger"
            ? true
            : existing["aria-invalid"],
      };
    },
  };
}

export function Field({
  label,
  htmlFor,
  hint,
  description,
  validation,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  description?: ReactNode;
  validation?: FieldValidation;
  children: FieldChildren;
}) {
  const generatedId = useId();
  const controlId = htmlFor ?? `${generatedId}-control`;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const validationId = validation ? `${generatedId}-validation` : undefined;

  if (typeof children === "function") {
    const binding = fieldControlBinding({
      controlId,
      descriptionId,
      validationId,
      validation,
    });
    return (
      <div className="tw:grid tw:min-w-0 tw:gap-1.5 tw:text-sm tw:font-medium tw:text-muted-foreground tw:[&>input]:w-full tw:[&>select]:w-full tw:[&>textarea]:w-full">
        <span className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1 tw:[overflow-wrap:anywhere]">
          <label htmlFor={controlId}>{label}</label>
          {hint}
        </span>
        {description ? (
          <span id={descriptionId} className="tw:sr-only">
            {description}
          </span>
        ) : null}
        {children(binding)}
        {validation ? (
          <FieldValidationMessage
            id={validationId}
            validation={validation}
          />
        ) : null}
      </div>
    );
  }

  return (
    <label className="tw:grid tw:min-w-0 tw:gap-1.5 tw:text-sm tw:font-medium tw:text-muted-foreground tw:[&>input]:w-full tw:[&>select]:w-full tw:[&>textarea]:w-full">
      <span className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1 tw:[overflow-wrap:anywhere]">
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
  description,
  validation,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  description?: ReactNode;
  validation?: FieldValidation;
  children: FieldChildren;
}) {
  const generatedId = useId();
  const controlId = htmlFor ?? `${generatedId}-control`;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const validationId = validation ? `${generatedId}-validation` : undefined;

  if (typeof children === "function") {
    const binding = fieldControlBinding({
      controlId,
      descriptionId,
      validationId,
      validation,
    });
    return (
      <div className="tw:grid tw:min-h-control-md tw:min-w-0 tw:grid-cols-[100px_minmax(0,1fr)] tw:items-start tw:gap-x-3 tw:gap-y-1.5 tw:@max-[560px]:grid-cols-1">
        <div className="tw:inline-flex tw:min-h-control-md tw:min-w-0 tw:items-center tw:gap-1 tw:text-sm tw:text-foreground tw:[overflow-wrap:anywhere] tw:@max-[560px]:min-h-0">
          <label htmlFor={controlId}>{label}</label>
          {hint}
        </div>
        <div className="tw:grid tw:min-w-0 tw:gap-1.5 tw:[&>input]:w-full tw:[&>select]:w-full tw:[&>textarea]:w-full">
          {description ? (
            <span id={descriptionId} className="tw:sr-only">
              {description}
            </span>
          ) : null}
          {children(binding)}
          {validation ? (
            <FieldValidationMessage
              id={validationId}
              validation={validation}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="tw:grid tw:min-h-control-md tw:min-w-0 tw:grid-cols-[100px_minmax(0,1fr)] tw:items-start tw:gap-x-3 tw:gap-y-1.5 tw:@max-[560px]:grid-cols-1">
      <label
        htmlFor={htmlFor}
        className="tw:inline-flex tw:min-h-control-md tw:min-w-0 tw:items-center tw:gap-1 tw:text-sm tw:text-foreground tw:[overflow-wrap:anywhere] tw:@max-[560px]:min-h-0"
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
    density?: "default" | "compact" | "xs";
    monospace?: boolean;
  }
>(function TextInput({ density = "default", monospace = false, ...props }, ref) {
  return (
    <input
      ref={ref}
      data-density={density}
      data-monospace={monospace}
      data-search={props.type === "search" || undefined}
      className="tw:[--ds-control-local-size:var(--ds-control-lg)] tw:data-[density=compact]:[--ds-control-local-size:var(--ds-control-md)] tw:data-[density=xs]:[--ds-control-local-size:var(--ds-control-sm)] tw:h-control-lg tw:min-h-control-lg tw:w-full tw:min-w-0 tw:max-w-full tw:rounded-sm tw:border tw:border-input tw:bg-background tw:px-3 tw:font-sans tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:data-[density=compact]:h-control-md tw:data-[density=compact]:min-h-control-md tw:data-[density=xs]:h-control-sm tw:data-[density=xs]:min-h-control-sm tw:data-[density=xs]:px-2 tw:data-[density=compact]:px-2 tw:data-[monospace=true]:font-mono tw:data-[search=true]:rounded-none tw:placeholder:text-muted-foreground tw:focus:border-ring tw:focus:ring-[3px] tw:focus:ring-ring/20 tw:disabled:cursor-default tw:disabled:opacity-50"
      {...props}
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
  return (
    <span
      data-density={density}
      className="tw:relative tw:grid tw:w-full tw:min-w-0 tw:max-w-full tw:items-center"
    >
      <select
        ref={ref}
        data-density={density}
        className="tw:peer tw:[--ds-control-local-size:var(--ds-control-lg)] tw:data-[density=compact]:[--ds-control-local-size:var(--ds-control-md)] tw:data-[density=xs]:[--ds-control-local-size:var(--ds-control-sm)] tw:h-control-lg tw:min-h-control-lg tw:w-full tw:min-w-0 tw:max-w-full tw:cursor-pointer tw:appearance-none tw:truncate tw:rounded-sm tw:border tw:border-input tw:bg-background tw:py-0 tw:pl-3 tw:pr-8 tw:font-sans tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:data-[density=compact]:h-control-md tw:data-[density=compact]:min-h-control-md tw:data-[density=xs]:h-control-sm tw:data-[density=xs]:min-h-control-sm tw:data-[density=xs]:pl-2 tw:data-[density=xs]:pr-7 tw:data-[density=compact]:pl-2 tw:hover:border-ring/50 tw:focus:border-ring tw:focus:ring-[3px] tw:focus:ring-ring/20 tw:disabled:cursor-default tw:disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        className="tw:pointer-events-none tw:absolute tw:right-2.5 tw:top-1/2 tw:-translate-y-1/2 tw:text-sm tw:text-muted-foreground tw:peer-disabled:opacity-50 tw:peer-data-[density=xs]:right-2"
      />
    </span>
  );
});

export const InlineSelect = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">
>(function InlineSelect({ children, ...props }, ref) {
  return (
    <span className="tw:relative tw:inline-flex tw:min-w-0 tw:max-w-full tw:items-center">
      <select
        ref={ref}
        className="tw:peer tw:[--ds-control-local-size:var(--ds-control-sm)] tw:block tw:h-control-sm tw:min-h-control-sm tw:min-w-0 tw:max-w-full tw:cursor-pointer tw:appearance-none tw:truncate tw:border-0 tw:bg-transparent tw:py-0 tw:pl-0 tw:pr-4 tw:font-sans tw:text-sm tw:font-medium tw:text-info tw:outline-none tw:focus-visible:rounded-xs tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:disabled:cursor-default tw:disabled:text-muted-foreground"
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        className="tw:pointer-events-none tw:absolute tw:right-0 tw:top-1/2 tw:-translate-y-1/2 tw:text-xs tw:text-info tw:peer-disabled:text-muted-foreground"
      />
    </span>
  );
});

export const TextAreaInput = forwardRef<
  HTMLTextAreaElement,
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">
>(function TextAreaInput(props, ref) {
  return (
    <textarea
      ref={ref}
      className="tw:min-h-24 tw:w-full tw:min-w-0 tw:max-w-full tw:resize-y tw:rounded-sm tw:border tw:border-input tw:bg-background tw:px-3 tw:py-2 tw:font-mono tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:placeholder:text-muted-foreground tw:focus:border-ring tw:focus:ring-[3px] tw:focus:ring-ring/20 tw:disabled:cursor-default tw:disabled:opacity-50"
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
