// Admin-only ciphertext backup inventory. Public responses deliberately expose only
// backup metadata; plaintext and envelope bytes never cross this boundary.
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "../../../../../../lib/db";
import { env } from "../../../../../../lib/env";
import { isUuid, jsonError, mutationAllowed, privateJson } from "../../../../../../lib/http";
import {
  workspaceAuditEvent,
  workspaceConnection,
  workspaceMetadataBackup,
  workspaceProfile,
} from "../../../../../../lib/schema";
import {
  sealWorkspaceMetadataBackup,
  snapshotHash,
  WORKSPACE_DATA_KEY_REFERENCE,
} from "../../../../../../lib/workspace-backup";
import { authorizeWorkspace } from "../../../../../../lib/workspace-authorization";
import { insertWorkspaceBackup } from "../../../../../../lib/workspace-backup-store";
import { parseSharedConnection } from "../../../../../../lib/workspace-connections";
import { WorkspaceKmsError } from "../../../../../../lib/workspace-kms-core";
import { logWorkspaceKmsFailure } from "../../../../../../lib/workspace-server-log";

type RouteContext = { params: Promise<{ workspaceId: string }> };

type BackupMetadata = {
  id: string;
  sourceRevision: number;
  keyReference: string;
  keyVersion: string;
  snapshotHash: string;
  createdAt: string;
};

type ReturnedBackupRow = {
  id: unknown;
  sourceRevision: unknown;
  keyReference: unknown;
  keyVersion: unknown;
  snapshotHash: unknown;
  createdAt: unknown;
};

function backupMetadata(row: typeof workspaceMetadataBackup.$inferSelect) {
  return {
    id: row.id,
    sourceRevision: row.sourceRevision,
    keyReference: row.keyReference,
    keyVersion: row.keyVersion,
    snapshotHash: row.snapshotHash,
    createdAt: row.createdAt.toISOString(),
  };
}

// db.execute returns driver rows, unlike Drizzle's mapped select rows. Validate the
// explicit RETURNING aliases before a driver int8/timestamptz can cross this boundary.
function returnedBackupMetadata(row: ReturnedBackupRow): BackupMetadata | null {
  const sourceRevision = typeof row.sourceRevision === "number"
    ? row.sourceRevision
    : typeof row.sourceRevision === "string" ? Number(row.sourceRevision) : NaN;
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt));
  if (
    typeof row.id !== "string"
    || !isUuid(row.id)
    || !Number.isSafeInteger(sourceRevision)
    || sourceRevision < 1
    || row.keyReference !== WORKSPACE_DATA_KEY_REFERENCE
    || typeof row.keyVersion !== "string"
    || !/^v[1-9][0-9]*$/.test(row.keyVersion)
    || typeof row.snapshotHash !== "string"
    || !/^[a-f0-9]{64}$/i.test(row.snapshotHash)
    || Number.isNaN(createdAt.valueOf())
  ) return null;
  return {
    id: row.id,
    sourceRevision,
    keyReference: row.keyReference,
    keyVersion: row.keyVersion,
    snapshotHash: row.snapshotHash,
    createdAt: createdAt.toISOString(),
  };
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (authorization.role !== "admin" && authorization.role !== "owner") {
    return jsonError("Workspace access denied", 403);
  }
  const backups = await db.select().from(workspaceMetadataBackup).where(and(
    eq(workspaceMetadataBackup.organizationId, workspaceId),
    isNull(workspaceMetadataBackup.deletedAt),
  )).orderBy(desc(workspaceMetadataBackup.createdAt));
  await db.insert(workspaceAuditEvent).values({
    organizationId: workspaceId,
    actorUserId: authorization.session.user.id,
    action: "workspace.backup.list",
    resourceType: "workspace_backup",
    redactedSummary: { count: backups.length },
    requestId: crypto.randomUUID(),
  });
  return privateJson({ workspaceId, backups: backups.map(backupMetadata) });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const [profile, connections] = await Promise.all([
    db.query.workspaceProfile.findFirst({
      where: eq(workspaceProfile.organizationId, workspaceId),
    }),
    db.select({
      id: workspaceConnection.id,
      contentRevision: workspaceConnection.contentRevision,
      name: workspaceConnection.name,
      engine: workspaceConnection.engine,
      provider: workspaceConnection.provider,
      driverId: workspaceConnection.driverId,
      host: workspaceConnection.host,
      port: workspaceConnection.port,
      database: workspaceConnection.databaseName,
      sslmode: workspaceConnection.sslmode,
      readonlyDefault: workspaceConnection.readonlyDefault,
      allowWrites: workspaceConnection.allowWrites,
      env: workspaceConnection.environment,
      schemaGroup: workspaceConnection.schemaGroup,
      credentialMode: workspaceConnection.credentialMode,
      providerIntegrationId: workspaceConnection.providerIntegrationId,
      providerResource: workspaceConnection.providerResource,
    }).from(workspaceConnection).where(and(
      eq(workspaceConnection.organizationId, workspaceId),
      isNull(workspaceConnection.deletedAt),
    )),
  ]);
  if (!profile) return jsonError("Workspace metadata is unavailable", 409);
  if (connections.length > 1_000) return jsonError("Workspace backup connection limit exceeded", 409);
  const snapshot = {
    version: 1 as const,
    workspace: {
      organizationId: workspaceId,
      lifecycleState: profile.lifecycleState,
      residencyRegion: profile.residencyRegion,
      revision: profile.revision,
    },
    connections: connections.map(({
      id,
      contentRevision,
      credentialMode,
      providerIntegrationId: _providerIntegrationId,
      providerResource: _providerResource,
      ...connection
    }) => ({
      id,
      contentRevision,
      ...parseSharedConnection(connection, {
        credentialMode: credentialMode === "managed" ? "managed" : "member_local",
      }),
    })),
  };
  const backupId = crypto.randomUUID();
  let sealed;
  try {
    sealed = await sealWorkspaceMetadataBackup({
      request,
      workspaceId,
      actorUserId: authorization.session.user.id,
      backupId,
      snapshot,
    });
  } catch (error) {
    logWorkspaceKmsFailure({
      operation: "encrypt",
      kind: error instanceof WorkspaceKmsError ? error.kind : "unexpected",
      status: error instanceof WorkspaceKmsError ? error.status : 0,
    });
    return jsonError(
      error instanceof WorkspaceKmsError && error.kind === "integrity"
        ? "Workspace backup key integrity validation failed"
        : "Workspace backup encryption is unavailable",
      error instanceof WorkspaceKmsError ? error.status : 503,
    );
  }
  const snapshotConnections = connections.map((connection) => ({
    id: connection.id,
    content_revision: connection.contentRevision,
    name: connection.name,
    engine: connection.engine,
    provider: connection.provider,
    driver_id: connection.driverId,
    host: connection.host,
    port: connection.port,
    database_name: connection.database,
    sslmode: connection.sslmode,
    readonly_default: connection.readonlyDefault,
    allow_writes: connection.allowWrites,
    environment: connection.env,
    schema_group: connection.schemaGroup,
    credential_mode: connection.credentialMode,
    provider_integration_id: connection.providerIntegrationId,
    provider_resource: connection.providerResource,
  }));
  const row = await insertWorkspaceBackup({ organizationId: workspaceId, backupId,
    authority: { sessionId: authorization.session.session.id, userId: authorization.session.user.id,
      membershipId: authorization.membership.id, role: authorization.role },
    revision: profile.revision, lifecycleState: profile.lifecycleState, residencyRegion: profile.residencyRegion,
    connections: snapshotConnections, sealed, snapshotHash: snapshotHash(snapshot),
  });
  const backup = row && returnedBackupMetadata(row as ReturnedBackupRow);
  if (!backup) return jsonError("Workspace metadata changed concurrently. Retry backup.", 409);
  return privateJson({ backup }, { status: 201 });
}
