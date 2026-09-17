import type {
  ConnectionProfile,
  DriverDescriptor,
} from "./domain";
import {
  isValidBigQueryDatasetId,
  isValidBigQueryProjectId,
} from "./bigQueryOnboardingModel";
import {
  CONNECTION_AUTO_DISCONNECT_MAX_SECONDS,
  CONNECTION_AUTO_DISCONNECT_MIN_SECONDS,
  CONNECTION_AUTO_DISCONNECT_SECONDS_PARAMETER,
  CONNECTION_KEEP_ALIVE_MAX_SECONDS,
  CONNECTION_KEEP_ALIVE_MIN_SECONDS,
  CONNECTION_KEEP_ALIVE_SECONDS_PARAMETER,
  CONNECTION_SSH_ALIAS_PARAMETER,
  CONNECTION_STARTUP_SCRIPT_MAX_LENGTH,
  CONNECTION_STARTUP_SCRIPT_PARAMETER,
  CONNECTION_TIME_ZONE_PARAMETER,
  isBoundedConnectionOptionSeconds,
  isConnectionTimeZone,
  isSshHostAlias,
} from "./options";

export type ConnectionDiagnosticCode =
  | "nameRequired"
  | "duplicateName"
  | "hostRequired"
  | "hostInvalid"
  | "portInvalid"
  | "sqliteFileRequired"
  | "cloudflareAccountRequired"
  | "cloudflareAccountInvalid"
  | "cloudflareD1DatabaseRequired"
  | "cloudflareD1DatabaseInvalid"
  | "mongoDatabaseRequired"
  | "targetDatabaseRequired"
  | "targetDatabaseInvalid"
  | "bigQueryProjectRequired"
  | "bigQueryProjectInvalid"
  | "bigQueryDatasetRequired"
  | "bigQueryDatasetInvalid"
  | "bigQueryLocationInvalid"
  | "bigQueryMaximumBytesBilledInvalid"
  | "timeZoneInvalid"
  | "keepAliveInvalid"
  | "autoDisconnectInvalid"
  | "startupScriptTooLong"
  | "sshAliasInvalid"
  | "sshTunnelSingleHostRequired"
  | "sshTunnelSrvUnsupported"
  | "driverCatalogUnavailable"
  | "driverUnavailable"
  | "driverInstallRequired";

export type ConnectionDiagnostic = {
  id: string;
  code: ConnectionDiagnosticCode;
  tone: "warning" | "danger";
  tab: "general" | "options" | "sshSsl";
  fieldId: string | null;
};

export function connectionDiagnosticBlocksTest(
  diagnostic: ConnectionDiagnostic,
): boolean {
  return diagnostic.tone === "danger" &&
    diagnostic.code !== "nameRequired" &&
    diagnostic.code !== "targetDatabaseRequired";
}

function issue(
  code: ConnectionDiagnosticCode,
  tone: ConnectionDiagnostic["tone"],
  fieldId: string | null,
  tab: ConnectionDiagnostic["tab"] = "general",
): ConnectionDiagnostic {
  return {
    id: `connection-${code}`,
    code,
    tone,
    tab,
    fieldId,
  };
}

export function diagnoseConnection(
  profile: ConnectionProfile,
  savedConnections: readonly ConnectionProfile[],
  drivers: readonly DriverDescriptor[],
  driverCatalogFailed: boolean,
  driverCatalogPending: boolean,
  portDraft = String(profile.port),
): ConnectionDiagnostic[] {
  const diagnostics: ConnectionDiagnostic[] = [];
  const name = profile.name.trim();

  if (!name) {
    diagnostics.push(issue("nameRequired", "danger", "connection-name"));
  } else if (
    savedConnections.some(
      (candidate) =>
        candidate.id !== profile.id &&
        candidate.name.trim().localeCompare(name, undefined, {
          sensitivity: "accent",
        }) === 0,
    )
  ) {
    diagnostics.push(
      issue("duplicateName", "warning", "connection-name"),
    );
  }

  if (profile.engine === "sqlite" && profile.provider === "cloudflareD1") {
    const accountId = profile.host.trim();
    if (!accountId) {
      diagnostics.push(
        issue("cloudflareAccountRequired", "danger", "connection-host"),
      );
    } else if (!/^[a-f0-9]{32}$/iu.test(accountId)) {
      diagnostics.push(
        issue("cloudflareAccountInvalid", "danger", "connection-host"),
      );
    }
    const databaseId = profile.database.trim();
    if (!databaseId) {
      diagnostics.push(
        issue("cloudflareD1DatabaseRequired", "danger", "connection-database"),
      );
    } else if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        databaseId,
      )
    ) {
      diagnostics.push(
        issue("cloudflareD1DatabaseInvalid", "danger", "connection-database"),
      );
    }
  } else if (profile.engine === "sqlite") {
    if (!profile.database.trim()) {
      diagnostics.push(
        issue(
          "sqliteFileRequired",
          "danger",
          "connection-database",
        ),
      );
    }
  } else if (profile.engine === "bigquery") {
    const project = profile.host.trim();
    if (!project) {
      diagnostics.push(
        issue("bigQueryProjectRequired", "danger", "connection-host"),
      );
    } else if (!isValidBigQueryProjectId(project)) {
      diagnostics.push(
        issue("bigQueryProjectInvalid", "danger", "connection-host"),
      );
    }
    const dataset = profile.database.trim();
    if (!dataset) {
      diagnostics.push(
        issue("bigQueryDatasetRequired", "danger", "connection-database"),
      );
    } else if (!isValidBigQueryDatasetId(dataset)) {
      diagnostics.push(
        issue("bigQueryDatasetInvalid", "danger", "connection-database"),
      );
    }
    const location = profile.extraParams.location?.trim() ?? "";
    if (
      location &&
      (location.length > 64 || !/^[A-Za-z0-9-]+$/u.test(location))
    ) {
      diagnostics.push(
        issue("bigQueryLocationInvalid", "danger", "connection-bigquery-location"),
      );
    }
    if (profile.workspaceAccess === "local") {
      const maximum = profile.extraParams.maximumBytesBilled ?? "";
      const maximumNumber = Number(maximum);
      if (
        !/^\d+$/u.test(maximum) ||
        !Number.isSafeInteger(maximumNumber) ||
        maximumNumber < 1 ||
        maximumNumber > 10 * 1024 ** 4
      ) {
        diagnostics.push(
          issue(
            "bigQueryMaximumBytesBilledInvalid",
            "danger",
            "connection-bigquery-maximum-bytes-billed",
          ),
        );
      }
    }
  } else {
    const host = profile.host.trim();
    if (!host) {
      diagnostics.push(
        issue("hostRequired", "danger", "connection-host"),
      );
    } else if (
      host.includes("://") ||
      host.split(",").some((part) => /\s/u.test(part))
    ) {
      diagnostics.push(
        issue("hostInvalid", "danger", "connection-host"),
      );
    }

    const mongoSrv =
      profile.engine === "mongodb" &&
      profile.extraParams.srv === "true";
    if (
      !mongoSrv &&
      (!/^\d+$/u.test(portDraft) ||
        !Number.isSafeInteger(Number(portDraft)) ||
        Number(portDraft) < 1 ||
        Number(portDraft) > 65_535)
    ) {
      diagnostics.push(
        issue("portInvalid", "danger", "connection-port"),
      );
    }
    if (
      profile.engine === "mongodb" &&
      !profile.database.trim()
    ) {
      diagnostics.push(
        issue(
          "mongoDatabaseRequired",
          "danger",
          "connection-database",
        ),
      );
    }
    if (profile.engine === "postgres" || profile.engine === "mysql") {
      const database = profile.database;
      if (!database.trim()) {
        diagnostics.push(issue("targetDatabaseRequired", "danger", "connection-database"));
      } else if (
        new TextEncoder().encode(database).length > 255 ||
        Array.from(database).some((character) => {
          const code = character.codePointAt(0)!;
          return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
        })
      ) {
        diagnostics.push(issue("targetDatabaseInvalid", "danger", "connection-database"));
      }
    }
  }

  const timeZone =
    profile.extraParams[CONNECTION_TIME_ZONE_PARAMETER]?.trim() ?? "";
  if (timeZone && !isConnectionTimeZone(timeZone)) {
    diagnostics.push(
      issue(
        "timeZoneInvalid",
        "danger",
        "connection-time-zone",
        "options",
      ),
    );
  }
  const keepAlive =
    profile.extraParams[CONNECTION_KEEP_ALIVE_SECONDS_PARAMETER];
  if (
    keepAlive !== undefined &&
    !isBoundedConnectionOptionSeconds(
      keepAlive,
      CONNECTION_KEEP_ALIVE_MIN_SECONDS,
      CONNECTION_KEEP_ALIVE_MAX_SECONDS,
    )
  ) {
    diagnostics.push(
      issue(
        "keepAliveInvalid",
        "danger",
        "connection-keep-alive",
        "options",
      ),
    );
  }
  const autoDisconnect =
    profile.extraParams[
      CONNECTION_AUTO_DISCONNECT_SECONDS_PARAMETER
    ];
  if (
    autoDisconnect !== undefined &&
    !isBoundedConnectionOptionSeconds(
      autoDisconnect,
      CONNECTION_AUTO_DISCONNECT_MIN_SECONDS,
      CONNECTION_AUTO_DISCONNECT_MAX_SECONDS,
    )
  ) {
    diagnostics.push(
      issue(
        "autoDisconnectInvalid",
        "danger",
        "connection-auto-disconnect",
        "options",
      ),
    );
  }
  const startupScript =
    profile.extraParams[CONNECTION_STARTUP_SCRIPT_PARAMETER] ?? "";
  if (startupScript.length > CONNECTION_STARTUP_SCRIPT_MAX_LENGTH) {
    diagnostics.push(
      issue(
        "startupScriptTooLong",
        "danger",
        "connection-startup-script",
        "options",
      ),
    );
  }
  const sshAlias =
    profile.extraParams[CONNECTION_SSH_ALIAS_PARAMETER]?.trim() ?? "";
  if (sshAlias && !isSshHostAlias(sshAlias)) {
    diagnostics.push(
      issue(
        "sshAliasInvalid",
        "danger",
        "connection-ssh-alias",
        "sshSsl",
      ),
    );
  } else if (sshAlias && profile.host.includes(",")) {
    diagnostics.push(
      issue(
        "sshTunnelSingleHostRequired",
        "danger",
        "connection-host",
        "general",
      ),
    );
  } else if (
    sshAlias &&
    profile.engine === "mongodb" &&
    profile.extraParams.srv === "true"
  ) {
    diagnostics.push(
      issue(
        "sshTunnelSrvUnsupported",
        "danger",
        "connection-ssh-alias",
        "sshSsl",
      ),
    );
  }

  if (driverCatalogFailed) {
    diagnostics.push(
      issue(
        "driverCatalogUnavailable",
        "danger",
        "connection-driver",
      ),
    );
    return diagnostics;
  }
  if (driverCatalogPending) return diagnostics;

  const compatibleDrivers = drivers.filter(
    (driver) =>
      driver.engine === profile.engine &&
      (profile.provider === "auto" ||
        driver.supportedProviders.includes(profile.provider)),
  );
  const selectedDriver = profile.driverId
    ? compatibleDrivers.find(
        (driver) => driver.id === profile.driverId,
      )
    : compatibleDrivers.find((driver) => driver.recommended) ??
      compatibleDrivers[0];

  if (!selectedDriver) {
    diagnostics.push(
      issue("driverUnavailable", "danger", "connection-driver"),
    );
  } else if (selectedDriver.installState !== "installed") {
    diagnostics.push(
      issue(
        "driverInstallRequired",
        "danger",
        "connection-driver",
      ),
    );
  }

  return diagnostics;
}
