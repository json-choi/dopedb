// Pure Google Cloud SQL setup rules for the Providers section: strict parsers for
// the caller's setup sessions, discovery inventories and save results, the
// approval gate that must pass before the reviewed prepare request is sent, and
// the in-memory repair intent that pins one managed connection's project and
// instance across a single browser authorization (never browser storage).
import type { WorkspaceAdminOperation, WorkspaceAdminScope } from "../../domain";
import {
  parseGcpSetupPermissionCheck,
  type GcpEnvironmentClassification,
  type GcpSetupInstance,
  type GcpSetupInventory,
  type GcpSetupPermissionCheck,
  type GcpSetupProject,
  type ManagedConnection,
} from "../domain";

export type GcpSetupSession = {
  id: string;
  account: string;
  expiresAt: string;
  createdAt: string;
};

export type GcpRepairTarget = {
  connectionId: string;
  integrationId: string;
  resource: { project: string; instance: string; database: string };
};

export type GcpInstanceInventory = {
  account: string;
  expiresAt: string;
  instances: GcpSetupInstance[];
};

export type PrepareGcpSetupOperation = Extract<
  WorkspaceAdminOperation,
  { kind: "prepareGcpSetup" }
>;

export type GcpSchemaChoice = {
  database: string;
  owner: string;
  approved: boolean;
};

export type GcpApprovalInput = {
  instance: GcpSetupInstance | null;
  environment: GcpEnvironmentClassification;
  productionApproved: boolean;
  iamChangeApproved: boolean;
  iamRoleGrantApproved: boolean;
  schema: GcpSchemaChoice;
  permissions: GcpSetupPermissionCheck | null;
};

// Matches the control plane's identifier check (RFC 4122 variant, versions 1-8).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const REPAIR_TTL_MS = 15 * 60_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !CONTROL.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** The caller's unconsumed setups, newest first; expired rows are dropped. */
export function parseGcpSetups(value: unknown, now = Date.now()): GcpSetupSession[] {
  const body = record(value);
  if (!body || !Array.isArray(body.setups)) {
    throw new Error("incompatible Google Cloud setup list");
  }
  return body.setups
    .flatMap((item): GcpSetupSession[] => {
      const row = record(item);
      if (
        !row
        || typeof row.id !== "string"
        || !UUID.test(row.id)
        || !boundedText(row.account, 320)
        || !timestamp(row.expiresAt)
        || !timestamp(row.createdAt)
        || Date.parse(row.expiresAt) <= now
      ) {
        return [];
      }
      return [{
        id: row.id,
        account: row.account,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      }];
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function parseGcpProjectInventory(value: unknown): GcpSetupInventory {
  const body = record(value);
  if (
    !body
    || !boundedText(body.account, 320)
    || !timestamp(body.expiresAt)
    || !Array.isArray(body.projects)
  ) {
    throw new Error("incompatible Google Cloud project list");
  }
  const projects = body.projects.flatMap((item): GcpSetupProject[] => {
    const row = record(item);
    if (
      !row
      || !boundedText(row.id, 128)
      || !boundedText(row.number, 64)
      || typeof row.name !== "string"
      || row.name.length > 512
    ) {
      return [];
    }
    return [{ id: row.id, number: row.number, name: row.name }];
  });
  return { account: body.account, expiresAt: body.expiresAt, projects };
}

/** Instances the setup can target; engines Desktop cannot connect are left out. */
export function parseGcpInstanceInventory(value: unknown): GcpInstanceInventory {
  const body = record(value);
  if (
    !body
    || !boundedText(body.account, 320)
    || !timestamp(body.expiresAt)
    || !Array.isArray(body.instances)
  ) {
    throw new Error("incompatible Cloud SQL instance list");
  }
  const instances = body.instances.flatMap((item): GcpSetupInstance[] => {
    const row = record(item);
    if (
      !row
      || !boundedText(row.id, 256)
      || typeof row.name !== "string"
      || (row.engine !== "postgres" && row.engine !== "mysql")
      || typeof row.region !== "string"
      || typeof row.ready !== "boolean"
      || (row.production !== true && row.production !== false && row.production !== "unknown")
      || typeof row.iamAuthenticationEnabled !== "boolean"
    ) {
      return [];
    }
    return [{
      id: row.id,
      name: row.name || row.id,
      engine: row.engine,
      region: row.region,
      ready: row.ready,
      production: row.production,
      iamAuthenticationEnabled: row.iamAuthenticationEnabled,
    }];
  });
  return { account: body.account, expiresAt: body.expiresAt, instances };
}

export function parseGcpPermissionResponse(value: unknown): GcpSetupPermissionCheck {
  const permissions = parseGcpSetupPermissionCheck(record(value)?.permissions);
  if (!permissions) throw new Error("incompatible Google Cloud permission check");
  return permissions;
}

/** A refused prepare that names the setup roles still missing for this project. */
export function permissionsFromConflict(body: unknown): GcpSetupPermissionCheck | null {
  const row = record(body);
  return row?.code === "gcp_setup_permissions_required"
    ? parseGcpSetupPermissionCheck(row.permissions)
    : null;
}

/** Only an explicit IAM-propagation-pending refusal may be resent, and only after this delay. */
export function iamPropagationRetryAfterMs(body: unknown): number | null {
  const row = record(body);
  const retryAfterMs = row?.retryAfterMs;
  return row?.code === "gcp_iam_propagation_pending"
    && typeof retryAfterMs === "number"
    && Number.isInteger(retryAfterMs)
    && retryAfterMs >= 1_000
    && retryAfterMs <= 30_000
    ? retryAfterMs
    : null;
}

export function parseGcpBootstrapTicket(value: unknown): string | null {
  const ticket = record(value)?.bootstrapTicket;
  return typeof ticket === "string"
    && ticket.length >= 80
    && ticket.length <= 32_768
    && !/[\s\u0000-\u001f\u007f]/.test(ticket)
    ? ticket
    : null;
}

export function parseSavedIntegrationId(value: unknown): string | null {
  const id = record(record(value)?.integration)?.id;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/** Pins the server-projected target of one managed Cloud SQL connection. */
export function gcpRepairTarget(managed: ManagedConnection): GcpRepairTarget | null {
  if (managed.provider !== "gcpCloudSql") return null;
  const resource = record(managed.resource);
  const project = resource?.project;
  const instance = resource?.instance;
  const database = resource?.database;
  if (
    !UUID.test(managed.connectionId)
    || !UUID.test(managed.integrationId)
    || !boundedText(project, 128)
    || !boundedText(instance, 256)
    || !boundedText(database, 128)
  ) {
    return null;
  }
  return {
    connectionId: managed.connectionId,
    integrationId: managed.integrationId,
    resource: { project, instance, database },
  };
}

type ScopeIdentity = Pick<WorkspaceAdminScope, "accountId" | "workspaceId">;

let pendingRepair: { scope: string; target: GcpRepairTarget; createdAt: number } | null = null;

function scopeIdentity(scope: ScopeIdentity) {
  return `${scope.accountId}:${scope.workspaceId}`;
}

/** Keeps one repair intent in memory while the browser authorization runs. */
export function rememberGcpRepair(scope: ScopeIdentity, target: GcpRepairTarget, now = Date.now()) {
  pendingRepair = { scope: scopeIdentity(scope), target, createdAt: now };
}

export function forgetGcpRepair() {
  pendingRepair = null;
}

/** The unexpired intent for exactly this account and workspace, if any. */
export function pendingGcpRepair(scope: ScopeIdentity, now = Date.now()): GcpRepairTarget | null {
  if (!pendingRepair) return null;
  if (
    pendingRepair.scope !== scopeIdentity(scope)
    || now < pendingRepair.createdAt
    || now - pendingRepair.createdAt > REPAIR_TTL_MS
  ) {
    pendingRepair = null;
    return null;
  }
  return pendingRepair.target;
}

export function gcpEffectiveProduction(
  instance: GcpSetupInstance | null,
  environment: GcpEnvironmentClassification,
): boolean {
  return Boolean(instance && (
    instance.production === true
    || (instance.production === "unknown" && environment === "production")
  ));
}

export function gcpSchemaRequested(schema: GcpSchemaChoice): boolean {
  return Boolean(schema.database.trim() || schema.owner.trim() || schema.approved);
}

/** Every approval the selected instance needs before the prepare request is allowed. */
export function gcpApprovalsComplete(input: GcpApprovalInput): boolean {
  const { instance, permissions, schema } = input;
  if (!instance || !instance.ready || !permissions) return false;
  if (instance.production === "unknown" && input.environment === "") return false;
  if (
    gcpSchemaRequested(schema)
    && !(
      schema.approved
      && instance.engine === "postgres"
      && schema.database.trim()
      && schema.owner.trim()
    )
  ) {
    return false;
  }
  if (gcpEffectiveProduction(instance, input.environment) && !input.productionApproved) {
    return false;
  }
  if (!instance.iamAuthenticationEnabled && !input.iamChangeApproved) return false;
  return permissions.missing.length === 0
    || (permissions.canAutoGrant && input.iamRoleGrantApproved);
}

/** The exact reviewed prepare request, or null while an approval is still missing. */
export function gcpPrepareOperation(input: GcpApprovalInput & {
  workspaceId: WorkspaceAdminScope["workspaceId"];
  setupId: string;
  project: GcpSetupProject | null;
  repairIntegrationId: string | null;
}): PrepareGcpSetupOperation | null {
  const { instance, permissions, project } = input;
  if (!project || !instance || !permissions || !gcpApprovalsComplete(input)) return null;
  const environmentClassification = instance.production === "unknown"
    ? input.environment || null
    : null;
  const schemaAuthority = input.schema.approved
    ? { database: input.schema.database.trim(), owner: input.schema.owner.trim() }
    : null;
  return {
    kind: "prepareGcpSetup",
    workspaceId: input.workspaceId,
    setupId: input.setupId,
    projectId: project.id,
    projectNumber: project.number,
    instanceId: instance.id,
    environmentClassification,
    approveProduction: gcpEffectiveProduction(instance, input.environment)
      && input.productionApproved,
    approveIamAuthenticationChange: !instance.iamAuthenticationEnabled
      && input.iamChangeApproved,
    approveIamRoleGrant: permissions.missing.length > 0
      && permissions.canAutoGrant
      && input.iamRoleGrantApproved,
    schemaAuthority,
    approveSchemaDelegation: schemaAuthority !== null,
    repairIntegrationId: input.repairIntegrationId,
  };
}
