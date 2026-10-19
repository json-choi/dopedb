// Explains a run that could not use this device's credential and offers the one
// command that fixes it: entering a local connection's password, connecting this
// member's own credential for a shared connection, or signing in again. An OS
// credential store that refused access is a different recovery with its own copy.
import { useI18n } from "../../lib/i18n";
import { requestAccountSettings } from "../settings/accountRequest";
import { requestConnectionCredentials } from "./connectionEditorShellBridge";
import type { ConnectionProfile } from "./domain";
import RecoveryNotice from "./RecoveryNotice";

const CREDENTIAL_RECOVERY_KINDS = new Set([
  "credentialBindingRequired",
  "keychain",
  "authenticationRequired",
] as const);

export type CredentialRecoveryErrorKind =
  typeof CREDENTIAL_RECOVERY_KINDS extends Set<infer Kind> ? Kind : never;

export function isCredentialRecoveryErrorKind(
  kind: string | null | undefined,
): kind is CredentialRecoveryErrorKind {
  return CREDENTIAL_RECOVERY_KINDS.has(kind as CredentialRecoveryErrorKind);
}

export default function ConnectionCredentialRecoveryNotice({
  connection,
  errorKind,
}: {
  connection: ConnectionProfile;
  errorKind: CredentialRecoveryErrorKind;
}) {
  const { t } = useI18n();
  const shared = connection.workspaceAccess !== "local";
  if (errorKind === "keychain") {
    return <RecoveryNotice message={t("sql.credentialStoreDenied.message")} />;
  }
  if (errorKind === "authenticationRequired") {
    // A shared connection opens only with this device's workspace session; a
    // provider CLI sign-in, such as BigQuery's, is renewed in the editor.
    const workspaceSession = shared && connection.engine !== "bigquery";
    return (
      <RecoveryNotice
        message={workspaceSession
          ? t("sql.authenticationRequired.workspace")
          : t("sql.authenticationRequired.provider")}
        action={{
          label: workspaceSession ? t("workspace.login") : t("connections.edit"),
          run: () =>
            workspaceSession
              ? requestAccountSettings()
              : requestConnectionCredentials(connection.id),
        }}
      />
    );
  }
  const canEnter = !shared || (
    connection.credentialMode === "memberLocal" &&
    connection.workspaceAccess !== "view" &&
    connection.engine !== "bigquery"
  );
  return (
    <RecoveryNotice
      message={shared
        ? t("sql.credentialRequired.shared")
        : t("sql.credentialRequired.local")}
      action={canEnter
        ? {
            label: shared
              ? t("workspace.bindCredentialsShort")
              : t("connections.enterPassword"),
            run: () => requestConnectionCredentials(connection.id),
          }
        : null}
    />
  );
}
