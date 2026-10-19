// Explains a run that could not use this device's credential and offers the one
// command that fixes it: entering a local connection's password, connecting this
// member's own credential for a shared connection, or signing in again. An OS
// credential store that refused access is a different recovery with its own copy.
import { useI18n } from "../../lib/i18n";
import { requestAccountSettings } from "../settings/accountRequest";
import { requestConnectionCredentials } from "./connectionEditorShellBridge";
import {
  canBindMemberCredentials,
  usesCliAuthentication,
  type ConnectionProfile,
} from "./domain";
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
    // provider CLI sign-in, such as BigQuery's or Wrangler's, is renewed in the editor.
    const workspaceSession = shared && !usesCliAuthentication(connection);
    const cloudflare = connection.engine === "sqlite";
    return (
      <RecoveryNotice
        message={workspaceSession
          ? t("sql.authenticationRequired.workspace")
          : t(cloudflare
              ? "sql.authenticationRequired.cloudflare"
              : "sql.authenticationRequired.provider")}
        action={{
          label: workspaceSession
            ? t("workspace.login")
            : t(cloudflare ? "connections.cloudflareD1SignIn" : "connections.edit"),
          run: () =>
            workspaceSession
              ? requestAccountSettings()
              : requestConnectionCredentials(connection.id),
        }}
      />
    );
  }
  if (connection.credentialMode === "provisioned") {
    // The account is generated; its Explorer status owns the only recovery.
    return <RecoveryNotice message={t("directAccess.credentialNotice")} />;
  }
  const canEnter = !shared || canBindMemberCredentials(connection);
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
