import type { GcpSetupCredential } from "./gcp-cloud-oauth";
import { ProviderRequestError } from "./provider-types";
import type { JsonObject } from "./gcp-cloud-bootstrap-core";

export type GcpDatabaseBootstrapUser = {
  user: JsonObject;
  created: boolean;
  engine: "postgres" | "mysql";
  originalRoles: string[];
  temporaryRoles: string[];
};

export type GcpDatabaseBootstrapRecovery = {
  version: 1;
  projectId: string;
  instanceId: string;
  setupEmail: string;
  userName: string;
  userHost: string;
  created: boolean;
  engine: "postgres" | "mysql";
  originalRoles: string[];
  temporaryRoles: string[];
};

export type GcpDatabaseBootstrapRecoveryWriter = (
  recovery: GcpDatabaseBootstrapRecovery | null,
) => Promise<void>;

function validDatabaseRoleList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 100
    && new Set(value).size === value.length
    && value.every((role) => (
      typeof role === "string"
      && role.length > 0
      && role.length <= 63
      && !/[\u0000-\u001f\u007f]/.test(role)
    ));
}

export function parseDatabaseBootstrapRecovery(
  value: unknown,
): GcpDatabaseBootstrapRecovery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const recovery = value as Record<string, unknown>;
  const originalRoles = recovery.originalRoles;
  const temporaryRoles = recovery.temporaryRoles;
  if (
    recovery.version !== 1
    || typeof recovery.projectId !== "string"
    || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(recovery.projectId)
    || typeof recovery.instanceId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,97}$/.test(recovery.instanceId)
    || typeof recovery.setupEmail !== "string"
    || !/^[^@\s]{1,128}@[^@\s]{1,190}$/.test(recovery.setupEmail)
    || typeof recovery.userName !== "string"
    || recovery.userName.length === 0
    || recovery.userName.length > 320
    || /[\u0000-\u001f\u007f]/.test(recovery.userName)
    || typeof recovery.userHost !== "string"
    || recovery.userHost.length > 255
    || /[\u0000-\u001f\u007f]/.test(recovery.userHost)
    || typeof recovery.created !== "boolean"
    || (recovery.engine !== "postgres" && recovery.engine !== "mysql")
    || !validDatabaseRoleList(originalRoles)
    || !validDatabaseRoleList(temporaryRoles)
  ) return null;
  if (temporaryRoles.some((role) => originalRoles.includes(role))) return null;
  return recovery as GcpDatabaseBootstrapRecovery;
}

export function databaseBootstrapRecovery(
  projectId: string,
  instanceId: string,
  setupEmail: string,
  bootstrap: GcpDatabaseBootstrapUser,
): GcpDatabaseBootstrapRecovery {
  if (typeof bootstrap.user.name !== "string") {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL setup database user is unavailable",
      409,
    );
  }
  return {
    version: 1,
    projectId,
    instanceId,
    setupEmail,
    userName: bootstrap.user.name,
    userHost: typeof bootstrap.user.host === "string" ? bootstrap.user.host : "",
    created: bootstrap.created,
    engine: bootstrap.engine,
    originalRoles: bootstrap.originalRoles,
    temporaryRoles: bootstrap.temporaryRoles,
  };
}

export async function updateDatabaseBootstrapRecovery(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
  bootstrap: GcpDatabaseBootstrapUser,
  temporaryRoles: string[],
  writeRecovery: GcpDatabaseBootstrapRecoveryWriter,
) {
  bootstrap.temporaryRoles = [...new Set([
    ...bootstrap.temporaryRoles,
    ...temporaryRoles.filter((role) => !bootstrap.originalRoles.includes(role)),
  ])].sort();
  await writeRecovery(databaseBootstrapRecovery(
    projectId,
    instanceId,
    credential.email,
    bootstrap,
  ));
}
