import "server-only";

import type { GcpSetupCredential } from "./gcp-cloud-oauth";
import { ProviderRequestError } from "./provider-types";
import {
  CLOUD_SQL_IDENTITY_PROPAGATION_TIMEOUT_MS,
  GcpUpstreamRequestError,
  PROPAGATION_RETRY_INTERVAL_MS,
  SQL_ADMIN_ORIGIN,
  googleRequest,
  object,
  type GcpCloudBootstrapInput,
  type JsonObject,
} from "./gcp-cloud-bootstrap-core";
import {
  dataApiState,
  databaseNames,
  ensureDatabaseUser,
  instanceDetails,
  prepareDatabaseBootstrapUser,
  restoreDatabaseBootstrapUser,
  setDataApiAccess,
  setDatabaseRoles,
  type GcpDatabaseBootstrapUser,
} from "./gcp-cloud-bootstrap-database";

export function responseStatusFailed(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as JsonObject;
  return typeof status.code === "number" && status.code !== 0;
}

export async function executeSql(
  credential: GcpSetupCredential,
  projectId: string,
  instanceId: string,
  database: string,
  statement: string,
) {
  const startedAt = Date.now();
  for (;;) {
    try {
      const body = (await googleRequest(
        credential,
        `${SQL_ADMIN_ORIGIN}/projects/${encodeURIComponent(projectId)}/instances/${
          encodeURIComponent(instanceId)
        }/executeSql`,
        {
          method: "POST",
          body: JSON.stringify({
            database,
            sqlStatement: statement,
            partialResultMode: "FAIL_PARTIAL_RESULT",
            autoIamAuthn: true,
          }),
        },
      ))!;
      const results = Array.isArray(body.results) ? body.results : [];
      if (
        responseStatusFailed(body.status)
        || results.some((value) => (
          value
          && typeof value === "object"
          && !Array.isArray(value)
          && (
            (value as JsonObject).partialResult === true
            || responseStatusFailed((value as JsonObject).status)
          )
        ))
      ) {
        throw new ProviderRequestError(
          "gcpCloudSql",
          "Cloud SQL rejected the least-privilege database grant",
          409,
        );
      }
      return;
    } catch (error) {
      const retryable = error instanceof GcpUpstreamRequestError
        ? [400, 403, 409, 429, 500, 502, 503].includes(
          error.upstreamStatus,
        )
        : error instanceof ProviderRequestError
          && [502, 503].includes(error.status);
      if (!retryable) throw error;
      if (
        Date.now() - startedAt
        >= CLOUD_SQL_IDENTITY_PROPAGATION_TIMEOUT_MS
      ) {
        throw new ProviderRequestError(
          "gcpCloudSql",
          "Cloud SQL IAM 데이터베이스 인증 반영이 지연되고 있습니다. 잠시 뒤 다시 시도하세요.",
          503,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, PROPAGATION_RETRY_INTERVAL_MS)
      );
    }
  }
}

export function pgIdentifier(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

export function pgLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function mysqlIdentifier(value: string) {
  return `\`${value.replaceAll("`", "``")}\``;
}

export function mysqlLiteral(value: string) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

export async function configurePostgresPrivileges(input: {
  control: GcpSetupCredential;
  executor: GcpSetupCredential;
  projectId: string;
  instanceId: string;
  databaseVersion: string;
  databases: string[];
  readUser: JsonObject;
  writeUser: JsonObject | null;
  fingerprint: string;
}) {
  const version = Number(/^POSTGRES_(\d+)/.exec(input.databaseVersion)?.[1] ?? "0");
  if (version >= 14) {
    await setDatabaseRoles(
      input.control,
      input.projectId,
      input.instanceId,
      input.readUser,
      ["pg_read_all_data"],
    );
    if (input.writeUser) {
      await setDatabaseRoles(
        input.control,
        input.projectId,
        input.instanceId,
        input.writeUser,
        ["pg_read_all_data", "pg_write_all_data"],
      );
    }
    if (typeof input.readUser.name !== "string") {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "Cloud SQL IAM username is unavailable",
        409,
      );
    }
    const writeName = typeof input.writeUser?.name === "string"
      ? input.writeUser.name
      : null;
    for (const database of input.databases.filter(
      (name) => !["template0", "template1"].includes(name),
    )) {
      await executeSql(
        input.executor,
        input.projectId,
        input.instanceId,
        database,
        `GRANT CONNECT ON DATABASE ${pgIdentifier(database)} TO ${
          pgIdentifier(input.readUser.name)
        };`
          + (writeName
            ? ` GRANT CONNECT ON DATABASE ${pgIdentifier(database)} TO ${
                pgIdentifier(writeName)
              };`
            : ""),
      );
    }
    return;
  }
  const readRole = `dopedb_r_${input.fingerprint}`;
  const writeRole = `dopedb_w_${input.fingerprint}`;
  const bootstrapDatabase = input.databases.includes("postgres")
    ? "postgres"
    : input.databases[0];
  if (!bootstrapDatabase) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL has no database to configure",
      409,
    );
  }
  await executeSql(
    input.executor,
    input.projectId,
    input.instanceId,
    bootstrapDatabase,
    `DO $dopedb$ BEGIN `
      + `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${pgLiteral(readRole)}) THEN `
      + `EXECUTE 'CREATE ROLE ${pgIdentifier(readRole)} NOLOGIN'; END IF; `
      + (input.writeUser
        ? `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${pgLiteral(writeRole)}) THEN `
          + `EXECUTE 'CREATE ROLE ${pgIdentifier(writeRole)} NOLOGIN'; END IF; `
          + `GRANT ${pgIdentifier(readRole)} TO ${pgIdentifier(writeRole)}; `
        : "")
      + "END $dopedb$;",
  );
  for (const database of input.databases.filter(
    (name) => !["template0", "template1"].includes(name),
  )) {
    const schemaGrants = [
      `EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', schema_name, ${pgLiteral(readRole)});`,
      `EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', schema_name, ${pgLiteral(readRole)});`,
      `EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', schema_name, ${pgLiteral(readRole)});`,
      ...(input.writeUser ? [
        `EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', schema_name, ${pgLiteral(writeRole)});`,
        `EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', schema_name, ${pgLiteral(writeRole)});`,
        `EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO %I', schema_name, ${pgLiteral(writeRole)});`,
      ] : []),
    ].join(" ");
    await executeSql(
      input.executor,
      input.projectId,
      input.instanceId,
      database,
      `GRANT CONNECT ON DATABASE ${pgIdentifier(database)} TO ${pgIdentifier(readRole)}; `
        + (input.writeUser
          ? `GRANT CONNECT ON DATABASE ${pgIdentifier(database)} TO ${pgIdentifier(writeRole)}; `
          : "")
        + "DO $dopedb$ DECLARE schema_name text; BEGIN "
        + "FOR schema_name IN SELECT schema_name FROM information_schema.schemata "
        + "WHERE schema_name <> 'information_schema' AND schema_name NOT LIKE 'pg_%' LOOP "
        + schemaGrants
        + " END LOOP; END $dopedb$;",
    );
  }
  await setDatabaseRoles(
    input.control,
    input.projectId,
    input.instanceId,
    input.readUser,
    [readRole],
  );
  if (input.writeUser) {
    await setDatabaseRoles(
      input.control,
      input.projectId,
      input.instanceId,
      input.writeUser,
      [writeRole],
    );
  }
}

export async function configureMysqlPrivileges(input: {
  executor: GcpSetupCredential;
  projectId: string;
  instanceId: string;
  databases: string[];
  readUser: JsonObject;
  writeUser: JsonObject | null;
}) {
  const account = (user: JsonObject) => {
    if (typeof user.name !== "string") {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "Cloud SQL IAM username is unavailable",
        409,
      );
    }
    return `${mysqlLiteral(user.name)}@${mysqlLiteral(
      typeof user.host === "string" && user.host ? user.host : "%",
    )}`;
  };
  for (const database of input.databases.filter(
    (name) => !["information_schema", "mysql", "performance_schema", "sys"].includes(name),
  )) {
    await executeSql(
      input.executor,
      input.projectId,
      input.instanceId,
      database,
      `GRANT SELECT ON ${mysqlIdentifier(database)}.* TO ${account(input.readUser)};`
        + (input.writeUser
          ? ` GRANT SELECT, INSERT, UPDATE, DELETE ON ${mysqlIdentifier(database)}.* TO ${
              account(input.writeUser)
            };`
          : ""),
    );
  }
}

export async function configureDatabasePrivileges(input: {
  credential: GcpSetupCredential;
  configuration: GcpCloudBootstrapInput;
  engine: "postgres" | "mysql";
  databaseVersion: string;
  readUser: JsonObject;
  writeUser: JsonObject | null;
  fingerprint: string;
}) {
  const databases = await databaseNames(
    input.credential,
    input.configuration.projectId,
    input.configuration.instanceId,
  );
  const details = await instanceDetails(
    input.credential,
    input.configuration.projectId,
    input.configuration.instanceId,
  );
  const dataApiInitiallyEnabled = dataApiState(details).enabled;
  let bootstrapUser: GcpDatabaseBootstrapUser | null = null;
  let failure: unknown = null;
  try {
    await setDataApiAccess(
      input.credential,
      input.configuration.projectId,
      input.configuration.instanceId,
      true,
    );
    bootstrapUser = await prepareDatabaseBootstrapUser(
      input.credential,
      input.configuration.projectId,
      input.configuration.instanceId,
      input.engine,
    );
    if (input.engine === "postgres") {
      await configurePostgresPrivileges({
        control: input.credential,
        executor: input.credential,
        projectId: input.configuration.projectId,
        instanceId: input.configuration.instanceId,
        databaseVersion: input.databaseVersion,
        databases,
        readUser: input.readUser,
        writeUser: input.writeUser,
        fingerprint: input.fingerprint,
      });
    } else {
      await configureMysqlPrivileges({
        executor: input.credential,
        projectId: input.configuration.projectId,
        instanceId: input.configuration.instanceId,
        databases,
        readUser: input.readUser,
        writeUser: input.writeUser,
      });
    }
  } catch (error) {
    failure = error;
  }

  const cleanupFailures: unknown[] = [];
  if (bootstrapUser) {
    await restoreDatabaseBootstrapUser(
      input.credential,
      input.configuration.projectId,
      input.configuration.instanceId,
      bootstrapUser,
    ).catch((error) => cleanupFailures.push(error));
  }
  if (!dataApiInitiallyEnabled) {
    await setDataApiAccess(
      input.credential,
      input.configuration.projectId,
      input.configuration.instanceId,
      false,
    ).catch((error) => cleanupFailures.push(error));
  }
  if (cleanupFailures.length > 0) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Temporary Cloud SQL privilege bootstrap cleanup failed. Retry before using the connection.",
      409,
    );
  }
  if (failure) throw failure;
  return databases;
}
