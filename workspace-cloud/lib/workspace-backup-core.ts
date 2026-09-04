// Canonical workspace metadata snapshots. Provider grants, target credentials and
// result rows have no representation here, so encrypted backups cannot contain them.
import { openEnvelope, sealEnvelope } from "./secret-envelope-core";
import { parseSharedConnection } from "./workspace-connections";
import { canonicalHash, canonicalJson } from "./workspace-versioning";

export const WORKSPACE_DATA_KEY_REFERENCE = "dopedb-workspace-data-key";

export function workspaceDataKeyVersion(version: number) {
  if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
    throw new Error("Invalid workspace data key version");
  }
  return `v${version}`;
}

export type WorkspaceMetadataSnapshot = {
  version: 1;
  workspace: {
    organizationId: string;
    lifecycleState: string;
    residencyRegion: string | null;
    revision: number;
  };
  connections: Array<{
    id: string;
    contentRevision: number;
  } & ReturnType<typeof parseSharedConnection>>;
};

export function workspaceBackupAad(workspaceId: string, backupId: string) {
  return `dopedb:workspace-backup:${workspaceId}:${backupId}`;
}

export function canonicalWorkspaceSnapshot(snapshot: WorkspaceMetadataSnapshot) {
  return {
    ...snapshot,
    connections: [...snapshot.connections].sort((left, right) =>
      left.id.localeCompare(right.id)),
  };
}

export function snapshotHash(snapshot: WorkspaceMetadataSnapshot): string {
  return canonicalHash(canonicalWorkspaceSnapshot(snapshot));
}

export function sealWorkspaceSnapshot(
  key: Buffer,
  workspaceId: string,
  backupId: string,
  snapshot: WorkspaceMetadataSnapshot,
): string {
  return sealEnvelope(
    key,
    canonicalJson(canonicalWorkspaceSnapshot(snapshot)),
    workspaceBackupAad(workspaceId, backupId),
  );
}

export function openWorkspaceSnapshot(
  key: Buffer,
  workspaceId: string,
  backupId: string,
  envelope: string,
): WorkspaceMetadataSnapshot {
  const plaintext = openEnvelope(key, envelope, workspaceBackupAad(workspaceId, backupId));
  return parseWorkspaceMetadataSnapshot(JSON.parse(plaintext), workspaceId);
}

export function parseWorkspaceMetadataSnapshot(
  value: unknown,
  workspaceId: string,
): WorkspaceMetadataSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid workspace backup snapshot");
  }
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.version !== 1
    || !snapshot.workspace
    || typeof snapshot.workspace !== "object"
    || Array.isArray(snapshot.workspace)
    || !Array.isArray(snapshot.connections)
    || snapshot.connections.length > 1_000
  ) {
    throw new Error("Invalid workspace backup snapshot");
  }
  const workspace = snapshot.workspace as Record<string, unknown>;
  if (
    workspace.organizationId !== workspaceId
    || typeof workspace.lifecycleState !== "string"
    || (workspace.residencyRegion !== null && typeof workspace.residencyRegion !== "string")
    || !Number.isSafeInteger(workspace.revision)
    || Number(workspace.revision) < 1
  ) {
    throw new Error("Invalid workspace backup snapshot");
  }
  const connectionIds = new Set<string>();
  for (const connection of snapshot.connections) {
    if (!connection || typeof connection !== "object" || Array.isArray(connection)) continue;
    const id = (connection as Record<string, unknown>).id;
    if (typeof id === "string" && connectionIds.has(id)) {
      throw new Error("Invalid workspace backup snapshot");
    }
    if (typeof id === "string") connectionIds.add(id);
  }
  return {
    version: 1,
    workspace: {
      organizationId: workspaceId,
      lifecycleState: workspace.lifecycleState,
      residencyRegion: workspace.residencyRegion as string | null,
      revision: Number(workspace.revision),
    },
    connections: snapshot.connections.map((connection) => {
      if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
        throw new Error("Invalid workspace backup snapshot");
      }
      const { id, contentRevision, ...template } = connection as Record<string, unknown>;
      if (
        typeof id !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        || !Number.isSafeInteger(contentRevision)
        || Number(contentRevision) < 1
      ) {
        throw new Error("Invalid workspace backup snapshot");
      }
      return {
        id,
        contentRevision: Number(contentRevision),
        ...parseSharedConnection(template),
      };
    }),
  };
}
