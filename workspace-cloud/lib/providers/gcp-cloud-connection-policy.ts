// Non-destructive managed data access. PostgreSQL predefined roles cover future
// schemas without changing application owners, ACLs, or default privileges.
import { ProviderRequestError } from "./provider-types";

export function gcpConnectionDatabaseRoles(databaseVersion: string, write: boolean) {
  const major = Number(/^POSTGRES_(\d+)/.exec(databaseVersion)?.[1] ?? 0);
  if (major < 14) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Automatic managed access requires PostgreSQL 14 or later. Use member-local credentials for this engine; existing database permissions were not changed.",
      409,
    );
  }
  return ["pg_read_all_data", ...(write ? ["pg_write_all_data"] : [])];
}

export function assertDatabaseUserRoles(
  user: Record<string, unknown>,
  expected: string[],
) {
  const roles = user.databaseRoles;
  if (
    user.type !== "CLOUD_IAM_SERVICE_ACCOUNT"
    || !Array.isArray(roles)
    || roles.length !== expected.length
    || expected.some((role) => !roles.includes(role))
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "The dedicated Cloud SQL data account does not have the expected roles. Existing roles were preserved; an administrator must review this account separately.",
      409,
    );
  }
}
