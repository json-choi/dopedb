// Explains a run that could not use this device's credential and offers the one
// command that fixes it: entering a local connection's password, connecting this
// member's own credential for a shared connection, or signing in again. An OS
// credential store that refused access is a different recovery with its own copy.
import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import { requestWorkspaceAdmin } from "../workspaceAdmin/navigationRequest";
import { requestConnectionCredentials } from "./connectionEditorShellBridge";
import type { ConnectionProfile } from "./domain";

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
    return (
      <InlineNotice tone="danger" icon="alert" role="alert">
        {t("sql.credentialStoreDenied.message")}
      </InlineNotice>
    );
  }
  if (errorKind === "authenticationRequired") {
    // A shared connection opens only with this device's workspace session; a
    // provider CLI sign-in, such as BigQuery's, is renewed in the editor.
    const workspaceSession = shared && connection.engine !== "bigquery";
    return (
      <InlineNotice
        tone="danger"
        icon="alert"
        role="alert"
        action={
          <Button
            size="compact"
            onClick={() =>
              workspaceSession
                ? requestWorkspaceAdmin("account")
                : requestConnectionCredentials(connection.id)
            }
          >
            {workspaceSession ? t("workspace.login") : t("connections.edit")}
          </Button>
        }
      >
        {workspaceSession
          ? t("sql.authenticationRequired.workspace")
          : t("sql.authenticationRequired.provider")}
      </InlineNotice>
    );
  }
  const canEnter = !shared || (
    connection.credentialMode === "memberLocal" &&
    connection.workspaceAccess !== "view" &&
    connection.engine !== "bigquery"
  );
  return (
    <InlineNotice
      tone="danger"
      icon="alert"
      role="alert"
      action={canEnter ? (
        <Button
          size="compact"
          onClick={() => requestConnectionCredentials(connection.id)}
        >
          {shared
            ? t("workspace.bindCredentialsShort")
            : t("connections.enterPassword")}
        </Button>
      ) : undefined}
    >
      {shared
        ? t("sql.credentialRequired.shared")
        : t("sql.credentialRequired.local")}
    </InlineNotice>
  );
}
