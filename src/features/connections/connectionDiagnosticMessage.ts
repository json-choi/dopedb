import type { I18nKey } from "../../lib/i18n";
import type { ConnectionDiagnosticCode } from "./diagnostics";

type Translate = (key: I18nKey) => string;

export function connectionDiagnosticMessage(
  t: Translate,
  code: ConnectionDiagnosticCode,
): string {
  const keys: Record<ConnectionDiagnosticCode, I18nKey> = {
    nameRequired: "connections.problemNameRequired",
    duplicateName: "connections.problemDuplicateName",
    hostRequired: "connections.problemHostRequired",
    hostInvalid: "connections.problemHostInvalid",
    portInvalid: "connections.problemPortInvalid",
    sqliteFileRequired: "connections.problemSqliteFileRequired",
    cloudflareAccountRequired:
      "connections.problemCloudflareAccountRequired",
    cloudflareAccountInvalid:
      "connections.problemCloudflareAccountInvalid",
    cloudflareD1DatabaseRequired:
      "connections.problemCloudflareD1DatabaseRequired",
    cloudflareD1DatabaseInvalid:
      "connections.problemCloudflareD1DatabaseInvalid",
    mongoDatabaseRequired: "connections.problemMongoDatabaseRequired",
    targetDatabaseRequired: "connections.problemTargetDatabaseRequired",
    targetDatabaseInvalid: "connections.problemTargetDatabaseInvalid",
    bigQueryProjectRequired: "connections.problemBigQueryProjectRequired",
    bigQueryProjectInvalid: "connections.problemBigQueryProjectInvalid",
    bigQueryDatasetRequired: "connections.problemBigQueryDatasetRequired",
    bigQueryDatasetInvalid: "connections.problemBigQueryDatasetInvalid",
    bigQueryLocationInvalid: "connections.problemBigQueryLocationInvalid",
    bigQueryMaximumBytesBilledInvalid:
      "connections.problemBigQueryMaximumBytesBilledInvalid",
    timeZoneInvalid: "connections.problemTimeZoneInvalid",
    keepAliveInvalid: "connections.problemKeepAliveInvalid",
    autoDisconnectInvalid: "connections.problemAutoDisconnectInvalid",
    startupScriptTooLong: "connections.problemStartupScriptTooLong",
    sshAliasInvalid: "connections.problemSshAliasInvalid",
    sshTunnelSingleHostRequired:
      "connections.problemSshTunnelSingleHostRequired",
    sshTunnelSrvUnsupported: "connections.problemSshTunnelSrvUnsupported",
    driverCatalogUnavailable:
      "connections.problemDriverCatalogUnavailable",
    driverUnavailable: "connections.problemDriverUnavailable",
    driverInstallRequired: "connections.problemDriverInstallRequired",
  };
  return t(keys[code]);
}
