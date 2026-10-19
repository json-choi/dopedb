// One labelled file-path field with a Browse command, shared by the connection
// editor's security tab and the member credential dialog so a TLS file looks and
// behaves the same wherever a member supplies one. The caller owns the value and
// the native file picker.
import { Button } from "../../design-system/components/Button";
import { Field, TextInput } from "../../design-system/components/FormControls";
import { useI18n } from "../../lib/i18n";

export default function ConnectionFilePathField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onBrowse,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBrowse: () => void;
}) {
  const { t } = useI18n();
  return (
    <Field label={label}>
      {({ controlProps }) => (
        <div className="ds-control-row tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2">
          <TextInput
            {...controlProps()}
            value={value}
            disabled={disabled}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          <Button
            aria-label={`${t("connections.browse")}: ${label}`}
            disabled={disabled}
            onClick={onBrowse}
          >
            {t("connections.browse")}
          </Button>
        </div>
      )}
    </Field>
  );
}
