// The credential method row of a new team connection: how members reach its database.
// One select shared by the editor's General tab and the provider-managed and
// per-member-account flows, so switching back to the editor form is always one choice.
import { PropertyRow, SelectInput } from "../../design-system/components/FormControls";
import type {
  CredentialMethod,
  CredentialMethodState,
} from "../../features/connections/useConnectionCredentialMethod";
import { useI18n, type I18nKey } from "../../lib/i18n";

const LABELS: Record<CredentialMethod, I18nKey> = {
  memberAccount: "connections.credentialMethod.memberAccount",
  providerManaged: "connections.credentialMethod.providerManaged",
  perMemberAccount: "connections.credentialMethod.perMemberAccount",
};

const HINTS: Record<CredentialMethod, I18nKey> = {
  memberAccount: "connections.credentialMethod.memberAccountHint",
  providerManaged: "connections.credentialMethod.providerManagedHint",
  perMemberAccount: "connections.credentialMethod.perMemberAccountHint",
};

export function ConnectionCredentialMethodRow({
  credentialMethod,
  disabled,
}: {
  credentialMethod: CredentialMethodState;
  disabled: boolean;
}) {
  const { t } = useI18n();
  if (!credentialMethod.selectable) return null;
  return (
    <PropertyRow
      label={t("connections.credentialMethod.label")}
      htmlFor="connection-credential-method"
      description={t(HINTS[credentialMethod.method])}
    >
      <SelectInput
        id="connection-credential-method"
        density="compact"
        value={credentialMethod.method}
        disabled={disabled}
        onChange={(event) =>
          credentialMethod.setMethod(event.target.value as CredentialMethod)}
      >
        {credentialMethod.options.map((option) => (
          <option key={option} value={option}>
            {t(LABELS[option])}
          </option>
        ))}
      </SelectInput>
    </PropertyRow>
  );
}
