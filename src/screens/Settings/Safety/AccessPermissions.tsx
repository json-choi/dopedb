// Presents the existing safety gates and the separate personal schema connection
// action. The parent owns all permission state; this surface never grants access.
import { useId } from "react";
import InfoTip from "../../../components/InfoTip";
import { Button } from "../../../design-system/components/Button";
import { CheckboxField } from "../../../design-system/components/FormControls";
import { InlineNotice, StatusBadge } from "../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../lib/i18n";

type Permission = {
  key: string;
  label: I18nKey;
  hint: I18nKey;
  checked: boolean;
  disabled: boolean;
  onChange?: (checked: boolean) => void;
};

export default function AccessPermissions({
  permissions, hint, unavailableHint, localSchemaRequired, onOpenAdminConnection, busy,
}: {
  permissions: Permission[];
  hint: I18nKey;
  unavailableHint: I18nKey | null;
  localSchemaRequired: boolean;
  onOpenAdminConnection: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const labelId = useId();
  return (
    <div className="tw:grid tw:gap-2 tw:pb-3">
      <div className="tw:flex tw:items-center tw:gap-2">
        <strong id={labelId} className="tw:text-sm">{t("safety.accessLevel")}</strong>
        <InfoTip label={t("safety.accessLevelHint")} />
      </div>
      <div role="group" aria-labelledby={labelId} className="tw:grid">
        {permissions.map((permission) => localSchemaRequired && permission.key === "schema" ? (
          <div key={permission.key} className="tw:flex tw:min-h-control-lg tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-t tw:border-border-subtle tw:py-2">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <strong className="tw:text-sm">{t(permission.label)}</strong>
              <StatusBadge density="compact">{t("safety.localSchemaRequired")}</StatusBadge>
            </div>
            <Button size="compact" disabled={busy} onClick={onOpenAdminConnection}>
              {t("safety.setupAdminConnection")}
            </Button>
          </div>
        ) : (
          <div key={permission.key} className="tw:grid tw:min-h-control-lg tw:grid-cols-[minmax(0,1fr)_20px] tw:items-center tw:gap-2 tw:border-t tw:border-border-subtle tw:py-2 tw:first-of-type:border-t-0">
            <CheckboxField checked={permission.checked} disabled={permission.disabled}
              onChange={permission.onChange ? (event) => permission.onChange?.(event.target.checked) : undefined}
              label={<strong>{t(permission.label)}</strong>} />
            <InfoTip label={t(permission.hint)} />
          </div>
        ))}
      </div>
      {!localSchemaRequired ? (
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">{t(hint)}</p>
      ) : null}
      {unavailableHint && !localSchemaRequired ? (
        <InlineNotice tone="warning" icon="info" role="status">{t(unavailableHint)}</InlineNotice>
      ) : null}
    </div>
  );
}
