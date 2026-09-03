import "server-only";

import {
  gcpCloudSqlEngine,
  parseGcpCloudSqlCredential,
  type GcpCloudSqlCredential,
} from "./gcp-cloud-sql-core";
import { listGcpOAuthInstances, type GcpSetupCredential } from "./gcp-cloud-oauth";
import { validateGcpCloudSqlCredential } from "./gcp-cloud-sql";
import { ProviderRequestError } from "./provider-types";
import { verifyVercelOidcToken } from "./vercel-oidc";
import {
  POOL_ID,
  PROVIDER_ID,
  enableServices,
  quotaProjectCredential,
  safeSegment,
  type GcpCloudBootstrapInput,
  type GcpCloudBootstrapResult,
  type JsonObject,
} from "./gcp-cloud-bootstrap-core";
import {
  ensurePool,
  ensureProvider,
  ensureServiceAccount,
  grantCloudSqlRoles,
  grantSchemaPolicyInspection,
  grantWorkloadIdentity,
  serviceAccountId,
  setupFingerprint,
  confirmProject,
} from "./gcp-cloud-bootstrap-iam";
import {
  databaseNames,
  enableIamAuthentication,
  ensureDatabaseUser,
  ensureEnvironmentClassification,
  instanceDetails,
} from "./gcp-cloud-bootstrap-database";
import { configureDatabasePrivileges } from "./gcp-cloud-bootstrap-sql";

export async function waitForFederation(
  credential: GcpCloudSqlCredential,
  oidcToken: string,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await validateGcpCloudSqlCredential(credential, oidcToken);
      return;
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof ProviderRequestError)
        || ![403, 409, 502, 503].includes(error.status)
      ) {
        throw error;
      }
      if (attempt < 19) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }
  throw lastError;
}

export async function bootstrapGcpCloudSql(input: {
  credential: GcpSetupCredential;
  oidcToken: string;
  configuration: GcpCloudBootstrapInput;
}): Promise<GcpCloudBootstrapResult> {
  const configuration = input.configuration;
  safeSegment(
    configuration.workspaceId,
    /^[0-9a-f]{8}-[0-9a-f-]{27,35}$/i,
    "Invalid workspace",
  );
  safeSegment(
    configuration.projectId,
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
    "Invalid Google Cloud project",
  );
  safeSegment(
    configuration.projectNumber,
    /^[1-9][0-9]{5,19}$/,
    "Invalid Google Cloud project number",
  );
  safeSegment(
    configuration.instanceId,
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,97}$/,
    "Invalid Cloud SQL instance",
  );
  const credential = quotaProjectCredential(
    input.credential,
    configuration.projectId,
  );
  const identity = await verifyVercelOidcToken(input.oidcToken);
  await confirmProject(
    credential,
    configuration.projectId,
    configuration.projectNumber,
  );
  const instances = await listGcpOAuthInstances(
    credential,
    configuration.projectId,
  );
  const selected = instances.find((item) => item.id === configuration.instanceId);
  if (!selected || !selected.ready) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "The selected Cloud SQL instance is not runnable",
      409,
    );
  }
  let selectedProduction = selected.production;
  if (selectedProduction === "unknown" && !configuration.environmentClassification) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Choose a production or development classification before connecting this instance",
      409,
    );
  }
  const requestedProduction = configuration.environmentClassification === "production";
  if (
    (
      selectedProduction === true
      || (selectedProduction === "unknown" && requestedProduction)
    )
    && !configuration.approveProduction
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Production Cloud SQL access requires explicit administrator approval",
      409,
    );
  }
  if (configuration.environmentClassification) {
    selectedProduction = await ensureEnvironmentClassification(
      credential,
      configuration,
      configuration.environmentClassification,
    );
  }
  if (selectedProduction === "unknown") {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL environment classification could not be confirmed",
      409,
    );
  }
  await enableServices(credential, configuration.projectNumber);
  await ensurePool(credential, configuration.projectNumber);
  await ensureProvider(credential, configuration.projectNumber, identity);
  const fingerprint = setupFingerprint(configuration);
  const description = `dopedb-managed:v1:${fingerprint}:${configuration.instanceId}`;
  const readEmail = await ensureServiceAccount(
    credential,
    configuration.projectId,
    serviceAccountId("read", fingerprint),
    description,
    `DopeDB read · ${configuration.instanceId}`.slice(0, 100),
  );
  const writeEmail = configuration.writeAccess
    ? await ensureServiceAccount(
        credential,
        configuration.projectId,
        serviceAccountId("write", fingerprint),
        description,
        `DopeDB write · ${configuration.instanceId}`.slice(0, 100),
      )
    : null;
  const schemaEmail = selected.engine === "postgres"
    ? await ensureServiceAccount(
        credential,
        configuration.projectId,
        serviceAccountId("schema", fingerprint),
        description,
        `DopeDB schema · ${configuration.instanceId}`.slice(0, 100),
      )
    : null;
  const principal = `principal://iam.googleapis.com/projects/${
    configuration.projectNumber
  }/locations/global/workloadIdentityPools/${POOL_ID}/subject/${
    identity.subject
  }`;
  await Promise.all([
    grantWorkloadIdentity(
      credential,
      configuration.projectId,
      readEmail,
      principal,
    ),
    ...(writeEmail ? [
      grantWorkloadIdentity(
        credential,
        configuration.projectId,
        writeEmail,
        principal,
      ),
    ] : []),
    ...(schemaEmail ? [
      grantWorkloadIdentity(
        credential,
        configuration.projectId,
        schemaEmail,
        principal,
      ),
    ] : []),
  ]);
  if (schemaEmail) {
    await grantSchemaPolicyInspection(
      credential,
      configuration.projectId,
      schemaEmail,
      readEmail,
    );
  }
  await grantCloudSqlRoles(
    credential,
    configuration,
    readEmail,
    writeEmail,
    schemaEmail,
    fingerprint,
  );
  const details = await instanceDetails(
    credential,
    configuration.projectId,
    configuration.instanceId,
  );
  const engine = gcpCloudSqlEngine(details.databaseVersion);
  if (!engine || engine !== selected.engine) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL engine changed during setup",
      409,
    );
  }
  const iamAuthenticationChanged = await enableIamAuthentication(
    credential,
    configuration,
    engine,
    details,
  );
  const readDatabaseUser = await ensureDatabaseUser(
    credential,
    configuration.projectId,
    configuration.instanceId,
    readEmail,
    engine,
  );
  let writeDatabaseUser: JsonObject | null = null;
  if (writeEmail) {
    writeDatabaseUser = await ensureDatabaseUser(
      credential,
      configuration.projectId,
      configuration.instanceId,
      writeEmail,
      engine,
    );
  }
  let schemaDatabaseUser: JsonObject | null = null;
  if (schemaEmail) {
    schemaDatabaseUser = await ensureDatabaseUser(
      credential,
      configuration.projectId,
      configuration.instanceId,
      schemaEmail,
      engine,
    );
  }
  if (typeof details.databaseVersion !== "string") {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL database version is unavailable",
      409,
    );
  }
  const configuredDatabases = await databaseNames(
    credential,
    configuration.projectId,
    configuration.instanceId,
  );
  const durableConfiguration = parseGcpCloudSqlCredential({
    projectId: configuration.projectId,
    projectNumber: configuration.projectNumber,
    workloadIdentityPoolId: POOL_ID,
    workloadIdentityProviderId: PROVIDER_ID,
    instanceId: configuration.instanceId,
    readServiceAccountEmail: readEmail,
    writeServiceAccountEmail: writeEmail,
    schemaServiceAccountEmail: schemaEmail,
    workloadIdentitySubject: identity.subject,
    databaseNames: configuredDatabases,
    dedicatedServiceAccountsConfirmed: true,
    instanceScopedIamConfirmed: true,
  });
  await waitForFederation(durableConfiguration, input.oidcToken);
  await configureDatabasePrivileges({
    credential,
    configuration,
    engine,
    databaseVersion: details.databaseVersion,
    databases: configuredDatabases,
    readUser: readDatabaseUser,
    writeUser: writeDatabaseUser,
    schemaUser: schemaDatabaseUser,
    fingerprint,
  });
  return {
    configuration: durableConfiguration,
    engine,
    production: selectedProduction,
    iamAuthenticationChanged,
    databaseUsers: {
      read: readEmail,
      write: writeEmail,
      schema: schemaEmail,
    },
  };
}
