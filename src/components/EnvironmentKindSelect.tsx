// The one environment question: a labelled select over the fixed kinds. Provider imports,
// direct database setup, and the Project dialog ask through this control instead of their
// own production or dev/staging/prod questions. `emptyLabel` adds an explicit "no environment"
// choice for optional use; `allowed` narrows the list (for example to kinds a Project lacks).
import {
  Field,
  SelectInput,
} from "../design-system/components/FormControls";
import {
  ENVIRONMENT_KIND_CHOICES,
  environmentKindLabel,
  parseEnvironmentKind,
  type EnvironmentKind,
} from "../lib/environmentKind";
import { useI18n } from "../lib/i18n";

export function EnvironmentKindSelect({
  value,
  onChange,
  label,
  emptyLabel,
  allowed = ENVIRONMENT_KIND_CHOICES,
  disabled = false,
  initialFocus = false,
}: {
  value: EnvironmentKind | null;
  onChange: (kind: EnvironmentKind | null) => void;
  label: string;
  emptyLabel?: string;
  allowed?: readonly EnvironmentKind[];
  disabled?: boolean;
  initialFocus?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Field label={label}>
      {(binding) => (
        <SelectInput
          {...binding.controlProps()}
          data-modal-initial-focus={initialFocus ? true : undefined}
          density="compact"
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onChange(parseEnvironmentKind(event.target.value))}
        >
          {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
          {allowed.map((kind) => (
            <option key={kind} value={kind}>
              {environmentKindLabel(t, kind)}
            </option>
          ))}
        </SelectInput>
      )}
    </Field>
  );
}
