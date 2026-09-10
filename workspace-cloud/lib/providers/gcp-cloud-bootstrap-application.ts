// Explicit Google setup provisions the approved target, verifies runtime access,
// creates data-only accounts without rewriting existing users or database ACLs.
import "server-only";

import {
  gcpCloudSqlEngine,
  parseGcpCloudSqlCredential,
  type GcpCloudSqlCredential,
} from "./gcp-cloud-sql-core";
import { listGcpOAuthInstances, type GcpSetupCredential } from "./gcp-cloud-oauth";
import { validateGcpCloudSqlCredential } from "./gcp-cloud-sql";
import { ProviderRequestError } from "./provider-types";
import { GcpManagedAccessRequestError } from "./gcp-cloud-managed-http";
import { verifyWorkloadOidcToken } from "./workload-oidc";
import {
  POOL_ID,
  PROVIDER_ID,
  enableServices,
  quotaProjectCredential,
  safeSegment,
  type GcpCloudBootstrapInput,
  type GcpCloudBootstrapResult,
} from "./gcp-cloud-bootstrap-core";
import {
  ensurePool,
  ensureProvider,
  ensureServiceAccount,
  grantCloudSqlRoles,
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
import { gcpConnectionDatabaseRoles } from "./gcp-cloud-connection-policy";

export class GcpIamPropagationPendingError extends ProviderRequestError {
  readonly code = "gcp_iam_propagation_pending";
  readonly retryAfterMs = 5_000;

  constructor() {
    super("gcpCloudSql",
      "Google Cloud runtime access is still denied after setup. Retry shortly; if this persists, check the Workload Identity and service-account IAM policies.",
      503);
    this.name = "GcpIamPropagationPendingError";
  }
}

export async function waitForFederation(
  credential: GcpCloudSqlCredential,
  oidcToken: string,
) {
  // Leave room for the remaining bootstrap and temporary-grant cleanup inside
  // the route's 300s limit. The session-bound browser can continue pending IAM
  // propagation across requests, each rechecking the same target and approvals.
  const deadline = Date.now() + 45_000;
  for (;;) {
    try {
      await validateGcpCloudSqlCredential(credential, oidcToken);
      return;
    } catch (error) {
      const iamPending = error instanceof GcpManagedAccessRequestError
        && error.upstreamStatus === 403
        && (error.googleReason === null || error.googleReason === "IAM_PERMISSION_DENIED");
      const unavailable = error instanceof ProviderRequestError && error.status === 503;
      // Local 409 policy drift and malformed responses are not propagation.
      // Live credential issuance never enters this setup-only wait loop.
      if (!iamPending && !unavailable) throw error;
      if (Date.now() + 5_000 >= deadline) {
        throw iamPending ? new GcpIamPropagationPendingError() : error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
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
  const identity = await verifyWorkloadOidcToken(input.oidcToken);
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
  // Reject engines requiring SQL privilege surgery before any provider mutation.
  const initialDetails = await instanceDetails(
    credential, configuration.projectId, configuration.instanceId,
  );
  const expectedVersion = String(initialDetails.databaseVersion);
  const readRoles = gcpConnectionDatabaseRoles(expectedVersion, false);
  const writeRoles = gcpConnectionDatabaseRoles(expectedVersion, true);
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
  // Connecting grants data access only. Schema ownership must never be acquired
  // by changing an existing application or shared ACL during setup/repair.
  const schemaEmail = null;
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
  ]);
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
  if (details.databaseVersion !== expectedVersion) {
    throw new ProviderRequestError("gcpCloudSql", "Cloud SQL database version changed during setup", 409);
  }
  await ensureDatabaseUser(
    credential, configuration.projectId, configuration.instanceId,
    readEmail, engine, readRoles,
  );
  if (writeEmail) {
    await ensureDatabaseUser(
      credential, configuration.projectId, configuration.instanceId,
      writeEmail, engine, writeRoles,
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
