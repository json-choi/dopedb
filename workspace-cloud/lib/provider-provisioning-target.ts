// Ephemeral, secret-free authority for one saved managed connection. The desktop
// consumes this only as discovery input; every mutation and lease re-authorizes the
// same connection independently.
import "server-only";

import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "./db";
import { jsonEqual } from "./d1/json";
import { providerImportAdapters } from "./providers/import-projection";
import {
  workspaceConnection,
  workspaceProviderImportRequest,
  workspaceProviderIntegration,
  workspaceProviderResource,
} from "./schema";

const AUTHORITY_TTL_MS = 5 * 60 * 1_000;
const PROVIDERS = ["neon", "gcpCloudSql", "planetScale"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[0-9a-f]{64}$/;

type CapabilityManifest = Readonly<{
  discover: true;
  importReadOnly: true;
  managedLease: true;
  write: boolean;
}>;

export type ProviderProvisioningTarget = Readonly<{
  connectionId: string;
  connectionRevision: string;
  integrationId: string;
  integrationGeneration: string;
  provider: (typeof PROVIDERS)[number];
  accountFingerprint: string;
  resourceFingerprint: string;
  displayName: string;
  resource: Readonly<Record<string, unknown>>;
  capabilityManifest: CapabilityManifest;
  production: boolean;
  safeMigrations: boolean | null;
  authorityExpiresAt: string;
}>;

type TargetRow = {
  connectionId: string;
  connectionRevision: number;
  connectionName: string;
  connectionEngine: string;
  integrationId: string;
  integrationGeneration: bigint;
  integrationProvider: string;
  externalAccountId: string;
  resourceFingerprint: string;
  resourceProvider: string;
  resource: unknown;
  redactedMetadata: unknown;
  capabilityManifest: unknown;
};

function isProvider(value: string): value is (typeof PROVIDERS)[number] {
  return (PROVIDERS as readonly string[]).includes(value);
}

function safeDisplayName(value: string) {
  return value.length > 0
    && value.length <= 120
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function exactRecord(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === fields.length
    && fields.every((field) => Object.hasOwn(record, field))
    ? record
    : null;
}

function parseCapabilities(value: unknown): CapabilityManifest | null {
  const row = exactRecord(value, ["discover", "importReadOnly", "managedLease", "write"]);
  return row
    && row.discover === true
    && row.importReadOnly === true
    && row.managedLease === true
    && typeof row.write === "boolean"
    ? {
        discover: true,
        importReadOnly: true,
        managedLease: true,
        write: row.write,
      }
    : null;
}

function productionClassification(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return row && typeof row.production === "boolean" ? row.production : null;
}

function safeMigrationsClassification(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return row && typeof row.safeMigrations === "boolean"
    ? row.safeMigrations
    : null;
}

function resourceEngine(value: Record<string, unknown>) {
  return value.engine === "postgres" || value.engine === "mysql" ? value.engine : null;
}

/**
 * Converts a tenant-scoped join into the only desktop provisioning projection.
 * Provider-specific reconstruction rejects extra fields before any identifier is
 * returned to the desktop.
 */
export function projectProviderProvisioningTarget(
  row: TargetRow,
  now = new Date(),
): ProviderProvisioningTarget {
  if (
    !UUID.test(row.connectionId)
    || !UUID.test(row.integrationId)
    || !Number.isSafeInteger(row.connectionRevision)
    || row.connectionRevision < 1
    || row.integrationGeneration < 1n
    || !isProvider(row.integrationProvider)
    || row.resourceProvider !== row.integrationProvider
    || !FINGERPRINT.test(row.resourceFingerprint)
    || !safeDisplayName(row.connectionName)
    || !row.externalAccountId
    || row.externalAccountId.length > 512
    || /[\u0000-\u001f\u007f]/.test(row.externalAccountId)
    || Number.isNaN(now.valueOf())
  ) {
    throw new Error("Invalid provider provisioning target");
  }
  const resource = providerImportAdapters[row.integrationProvider].reconstruct(row.resource);
  const engine = resourceEngine(resource as unknown as Record<string, unknown>);
  const capabilities = parseCapabilities(row.capabilityManifest);
  const production = productionClassification(row.redactedMetadata);
  const safeMigrations = safeMigrationsClassification(row.redactedMetadata);
  if (
    !engine
    || engine !== row.connectionEngine
    || !capabilities
    || production === null
    || (
      row.integrationProvider === "planetScale"
      && engine === "mysql"
      && safeMigrations === null
    )
  ) {
    throw new Error("Invalid provider provisioning target");
  }
  return {
    connectionId: row.connectionId,
    connectionRevision: row.connectionRevision.toString(),
    integrationId: row.integrationId,
    integrationGeneration: row.integrationGeneration.toString(),
    provider: row.integrationProvider,
    accountFingerprint: createHash("sha256").update(row.externalAccountId).digest("hex"),
    resourceFingerprint: row.resourceFingerprint,
    displayName: row.connectionName,
    resource: { ...resource },
    capabilityManifest: capabilities,
    production,
    safeMigrations: row.integrationProvider === "planetScale" && engine === "mysql"
      ? safeMigrations
      : null,
    authorityExpiresAt: new Date(now.valueOf() + AUTHORITY_TTL_MS).toISOString(),
  };
}

/**
 * Reads one canonical imported target after the route has authorized `manage` on
 * this connection. Tenant, connection, integration, resource, import witness, and
 * active lifecycle predicates remain in the same SQL query.
 */
export async function loadProviderProvisioningTarget(input: {
  organizationId: string;
  connectionId: string;
  now?: Date;
  cleanup?: boolean;
}): Promise<ProviderProvisioningTarget | null> {
  const productionPolicy = input.cleanup
    ? sql`(
        json_type(${workspaceProviderResource.redactedMetadata}, '$.production') = 'false'
        OR ${workspaceProviderImportRequest.productionApproved} = TRUE
      )`
    : sql`(
        json_type(${workspaceProviderResource.redactedMetadata}, '$.production') = 'false'
        OR (
          ${workspaceProviderResource.provider} IN ('gcpCloudSql', 'planetScale', 'neon')
          AND json_type(${workspaceProviderResource.redactedMetadata}, '$.production') = 'true'
          AND (
            ${workspaceProviderResource.provider} <> 'planetScale'
            OR ${workspaceProviderResource.resource}->>'engine' = 'postgres'
            OR json_type(${workspaceProviderResource.redactedMetadata}, '$.safeMigrations') = 'true'
          )
          AND ${workspaceProviderImportRequest.productionApproved} = TRUE
        )
      )`;
  const rows = await db.select({
    connectionId: workspaceConnection.id,
    connectionRevision: workspaceConnection.revision,
    connectionName: workspaceConnection.name,
    connectionEngine: workspaceConnection.engine,
    integrationId: workspaceProviderIntegration.id,
    integrationGeneration: workspaceProviderIntegration.generation,
    integrationProvider: workspaceProviderIntegration.provider,
    externalAccountId: workspaceProviderIntegration.externalAccountId,
    resourceFingerprint: workspaceProviderResource.resourceFingerprint,
    resourceProvider: workspaceProviderResource.provider,
    resource: workspaceProviderResource.resource,
    redactedMetadata: workspaceProviderResource.redactedMetadata,
    capabilityManifest: workspaceProviderResource.capabilityManifest,
  }).from(workspaceConnection)
    .innerJoin(workspaceProviderIntegration, and(
      eq(workspaceProviderIntegration.organizationId, workspaceConnection.organizationId),
      eq(workspaceProviderIntegration.id, workspaceConnection.providerIntegrationId),
      eq(workspaceProviderIntegration.provider, workspaceConnection.provider),
    ))
    .innerJoin(workspaceProviderResource, and(
      eq(workspaceProviderResource.organizationId, workspaceConnection.organizationId),
      eq(workspaceProviderResource.id, workspaceConnection.providerResourceId),
      eq(workspaceProviderResource.provider, workspaceConnection.provider),
    ))
    .innerJoin(workspaceProviderImportRequest, and(
      eq(workspaceProviderImportRequest.organizationId, workspaceConnection.organizationId),
      eq(workspaceProviderImportRequest.connectionId, workspaceConnection.id),
      eq(workspaceProviderImportRequest.resourceId, workspaceProviderResource.id),
    ))
    .where(and(
      eq(workspaceConnection.organizationId, input.organizationId),
      eq(workspaceConnection.id, input.connectionId),
      eq(workspaceConnection.credentialMode, "managed"),
      isNull(workspaceConnection.deletedAt),
      isNull(workspaceConnection.revocationPendingAt),
      eq(workspaceProviderIntegration.status, "active"),
      eq(workspaceProviderIntegration.refreshPhase, "idle"),
      isNull(workspaceProviderIntegration.revokedAt),
      isNull(workspaceProviderIntegration.revocationPendingAt),
      jsonEqual(workspaceConnection.providerResource, workspaceProviderResource.resource),
      sql`json_type(${workspaceProviderResource.capabilityManifest}, '$.discover') = 'true'`,
      sql`json_type(${workspaceProviderResource.capabilityManifest}, '$.importReadOnly') = 'true'`,
      sql`json_type(${workspaceProviderResource.capabilityManifest}, '$.managedLease') = 'true'`,
      sql`json_type(${workspaceProviderResource.capabilityManifest}, '$.write') IN ('true', 'false')`,
      productionPolicy,
    ))
    .limit(2);
  if (rows.length !== 1) return null;
  return projectProviderProvisioningTarget(rows[0], input.now);
}
