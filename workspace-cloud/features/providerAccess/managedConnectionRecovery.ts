// Keeps one non-secret managed-connection repair intent across a provider OAuth
// round trip. The server snapshot remains authoritative for the target itself.
import type { ManagedConnection } from "./domain";

const RECOVERY_VERSION = 1 as const;
const RECOVERY_TTL_MS = 15 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ManagedConnectionRecoveryIntent = Readonly<{
  version: typeof RECOVERY_VERSION;
  workspaceId: string;
  connectionId: string;
  integrationId: string;
  provider: "gcpCloudSql";
  createdAt: number;
}>;

export type GcpManagedConnectionRecoveryTarget = Readonly<{
  intent: ManagedConnectionRecoveryIntent;
  resource: Readonly<{
    project: string;
    instance: string;
    database: string;
  }>;
}>;

function storageKey(workspaceId: string) {
  return `dopedb:managed-connection-recovery:${workspaceId}`;
}

export function saveManagedConnectionRecoveryIntent(
  storage: Pick<Storage, "setItem">,
  input: Omit<ManagedConnectionRecoveryIntent, "version" | "createdAt">,
) {
  storage.setItem(storageKey(input.workspaceId), JSON.stringify({
    ...input,
    version: RECOVERY_VERSION,
    createdAt: Date.now(),
  } satisfies ManagedConnectionRecoveryIntent));
}

export function clearManagedConnectionRecoveryIntent(
  storage: Pick<Storage, "removeItem">,
  workspaceId: string,
) {
  storage.removeItem(storageKey(workspaceId));
}

export function readManagedConnectionRecoveryIntent(
  storage: Pick<Storage, "getItem" | "removeItem">,
  workspaceId: string,
  now = Date.now(),
): ManagedConnectionRecoveryIntent | null {
  const raw = storage.getItem(storageKey(workspaceId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ManagedConnectionRecoveryIntent>;
    if (
      value.version !== RECOVERY_VERSION
      || value.workspaceId !== workspaceId
      || value.provider !== "gcpCloudSql"
      || !UUID.test(value.connectionId ?? "")
      || !UUID.test(value.integrationId ?? "")
      || typeof value.createdAt !== "number"
      || !Number.isSafeInteger(value.createdAt)
      || value.createdAt > now
      || now - value.createdAt > RECOVERY_TTL_MS
    ) {
      throw new Error("invalid managed connection recovery intent");
    }
    return value as ManagedConnectionRecoveryIntent;
  } catch {
    storage.removeItem(storageKey(workspaceId));
    return null;
  }
}

export function resolveGcpManagedConnectionRecoveryTarget(
  intent: ManagedConnectionRecoveryIntent | null,
  managedConnections: ManagedConnection[],
): GcpManagedConnectionRecoveryTarget | null {
  if (!intent) return null;
  const managed = managedConnections.find((item) => (
    item.connectionId === intent.connectionId
    && item.integrationId === intent.integrationId
    && item.provider === "gcpCloudSql"
  ));
  const resource = managed?.resource as Record<string, unknown> | undefined;
  if (
    typeof resource?.project !== "string"
    || typeof resource.instance !== "string"
    || typeof resource.database !== "string"
  ) return null;
  return {
    intent,
    resource: {
      project: resource.project,
      instance: resource.instance,
      database: resource.database,
    },
  };
}
