// Member-centric view of every shared database's grants: the strict parser for the
// control-plane aggregate, the capability <-> none/read/write mapping the Members editor
// offers, the pure effective-level rule (mirroring the server's) that decides which
// changes lower a provisioned member's database access, and the revocation targets those
// changes carry. Requests and wording live in the commands controller and components.
import type { I18nKey } from "../../../lib/i18n";
import type { WorkspaceRole } from "../../workspaces/domain";
import {
  DIRECT_FAILURE_CODES,
  type DirectFailureCode,
  type DirectLevel,
  type DirectProvisioningState,
  type DirectProvisioningStatus,
  type DirectRevocationTarget,
} from "../../directAccess/domain";
import { connectionId as toConnectionId } from "../../connections/domain";
import type { SharedDatabase } from "../access/domain";
import type { ConnectionCapability } from "../domain";

export type GrantLevel = "none" | "read" | "write";
export type GrantOrigin = "explicit" | "team";

export interface MemberGrantEntry {
  connectionId: string;
  capability: ConnectionCapability;
  origin: GrantOrigin;
  /** Present only for a provisioned (direct connection) database. */
  provisioning: DirectProvisioningStatus | null;
}

export interface MemberGrantsRow {
  memberId: string;
  role: WorkspaceRole;
  grants: MemberGrantEntry[];
}

export class MemberGrantsShapeError extends Error {
  constructor() {
    super("The workspace service returned an incompatible member grant list.");
    this.name = "MemberGrantsShapeError";
  }
}

const ROLES: readonly WorkspaceRole[] = ["viewer", "analyst", "editor", "admin", "owner"];
const CAPABILITIES: readonly ConnectionCapability[] = ["view", "read", "use", "manage"];
const STATES: readonly DirectProvisioningState[] = [
  "not_requested",
  "requested",
  "applying",
  "ready",
  "failed",
  "drop_pending",
  "dropped",
];
const LEVELS: readonly DirectLevel[] = ["none", "read", "write"];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function member<T>(list: readonly T[], value: unknown): T {
  const found = list.find((item) => item === value);
  if (found === undefined) throw new MemberGrantsShapeError();
  return found;
}

function parseProvisioning(value: unknown): DirectProvisioningStatus {
  const row = record(value);
  if (!row) throw new MemberGrantsShapeError();
  const failureCode = row.failureCode === null
    ? null
    : member<DirectFailureCode>(DIRECT_FAILURE_CODES, row.failureCode);
  return {
    state: member(STATES, row.state),
    level: member(LEVELS, row.level),
    principalName: typeof row.principalName === "string" ? row.principalName : null,
    lastSyncedAt: typeof row.lastSyncedAt === "string" ? row.lastSyncedAt : null,
    failureCode,
  };
}

export function parseMemberGrants(value: unknown, workspaceId: string): MemberGrantsRow[] {
  const body = record(value);
  if (!body || body.workspaceId !== workspaceId || !Array.isArray(body.members)) {
    throw new MemberGrantsShapeError();
  }
  return body.members.map((item) => {
    const row = record(item);
    if (!row || typeof row.memberId !== "string" || !Array.isArray(row.grants)) {
      throw new MemberGrantsShapeError();
    }
    return {
      memberId: row.memberId,
      role: member(ROLES, row.role),
      grants: row.grants.map((grant): MemberGrantEntry => {
        const entry = record(grant);
        if (!entry || typeof entry.connectionId !== "string") throw new MemberGrantsShapeError();
        return {
          connectionId: entry.connectionId,
          capability: member(CAPABILITIES, entry.capability),
          origin: member<GrantOrigin>(["explicit", "team"], entry.origin),
          provisioning: entry.provisioning === undefined ? null : parseProvisioning(entry.provisioning),
        };
      }),
    };
  });
}

const CAPABILITY_RANK: Record<ConnectionCapability, number> = {
  view: 0,
  read: 1,
  use: 2,
  manage: 3,
};

/** The editor's value for a grant: view-only and no grant both read as "no access" levels. */
export function grantLevelOf(capability: ConnectionCapability | null): GrantLevel | "view" | "manage" {
  if (capability === null) return "none";
  if (capability === "read") return "read";
  if (capability === "use") return "write";
  return capability;
}

/** The capability a level selects; "write" is the `use` capability. */
export function capabilityOf(level: GrantLevel | "manage"): ConnectionCapability | null {
  if (level === "none") return null;
  if (level === "read") return "read";
  return level === "write" ? "use" : "manage";
}

/**
 * The control plane only raises or keeps a grant. Lowering removes the current
 * grant first (draining that member's active credentials), then grants the lower
 * level; choosing no access is the removal alone.
 */
export type GrantChangePlan = {
  remove: boolean;
  grant: ConnectionCapability | null;
};

export function planGrantChange(
  previous: ConnectionCapability | null,
  next: ConnectionCapability | null,
): GrantChangePlan | null {
  if (previous === next) return null;
  if (next === null) return { remove: true, grant: null };
  return {
    remove: previous !== null && CAPABILITY_RANK[next] < CAPABILITY_RANK[previous],
    grant: next,
  };
}

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  analyst: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

/** Editors and above may write; below that a role caps every grant at read. */
export function roleCanWrite(role: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.editor;
}

const LEVEL_RANK: Record<DirectLevel, number> = { none: 0, read: 1, write: 2 };

/** What a provisioned database account may do: the server's rule, computed locally. */
export function effectiveDirectLevel(
  role: WorkspaceRole,
  capability: ConnectionCapability | null,
  writeCeiling: boolean,
): DirectLevel {
  if (capability === null || capability === "view") return "none";
  if (capability === "read") return "read";
  return roleCanWrite(role) && writeCeiling ? "write" : "read";
}

export type WriteBlock = "ceilingOff" | "managedUnavailable" | "roleLimited";

export const WRITE_BLOCK_KEYS: Record<WriteBlock, I18nKey> = {
  ceilingOff: "workspaceMembers.writeBlockedCeiling",
  managedUnavailable: "workspaceMembers.writeBlockedManaged",
  roleLimited: "workspaceMembers.writeBlockedRole",
};

/** Why the "write" level cannot be chosen for this member on this database, or null. */
export function writeBlock(database: SharedDatabase, role: WorkspaceRole): WriteBlock | null {
  if (database.provisioned) {
    if (!database.allowWrites) return "ceilingOff";
  } else if (database.credentialMode === "managed") {
    if (!database.allowWrites || !database.writeAvailable) return "managedUnavailable";
  } else {
    // Members' own credentials are read-only; "use" there is not a write level.
    return null;
  }
  return roleCanWrite(role) ? null : "roleLimited";
}

export interface RevocationPlan {
  targetLevel: "none" | "read";
  targets: DirectRevocationTarget[];
}

function provisionedGrants(
  row: MemberGrantsRow,
  databases: ReadonlyMap<string, SharedDatabase>,
) {
  return row.grants.flatMap((grant) => {
    const database = databases.get(grant.connectionId);
    return database?.provisioned ? [{ grant, database }] : [];
  });
}

/** Removing a member revokes the account they hold on every provisioned database. */
export function removalPlan(
  row: MemberGrantsRow,
  databases: ReadonlyMap<string, SharedDatabase>,
): RevocationPlan | null {
  const targets = provisionedGrants(row, databases).map(({ grant }) => ({
    connectionId: toConnectionId(grant.connectionId),
    memberIds: [row.memberId],
  }));
  return targets.length > 0 ? { targetLevel: "none", targets } : null;
}

/**
 * A role change that lowers the effective level of some provisioned account. The
 * accounts are revoked to the lowest level any of them ends on; the worker restores
 * the higher ones afterwards.
 */
export function roleLoweringPlan(
  row: MemberGrantsRow,
  nextRole: WorkspaceRole,
  databases: ReadonlyMap<string, SharedDatabase>,
): RevocationPlan | null {
  const lowered = provisionedGrants(row, databases).flatMap(({ grant, database }) => {
    const before = effectiveDirectLevel(row.role, grant.capability, database.allowWrites);
    const after = effectiveDirectLevel(nextRole, grant.capability, database.allowWrites);
    return LEVEL_RANK[after] < LEVEL_RANK[before] ? [{ grant, after }] : [];
  });
  if (lowered.length === 0) return null;
  const lowest = lowered.reduce<DirectLevel>(
    (min, { after }) => (LEVEL_RANK[after] < LEVEL_RANK[min] ? after : min),
    "write",
  );
  return {
    targetLevel: lowest === "none" ? "none" : "read",
    targets: lowered.map(({ grant }) => ({
      connectionId: toConnectionId(grant.connectionId),
      memberIds: [row.memberId],
    })),
  };
}
