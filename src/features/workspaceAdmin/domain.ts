// Workspace administration wire contracts. The operation union mirrors the Rust
// `WorkspaceAdminOperation` enum variant-for-variant and field-for-field; Rust
// validates identifiers and bounds before any request reaches the control plane.
import type { AccountId, WorkspaceId, WorkspaceRole } from "../workspaces/domain";

export type AssignableWorkspaceRole = Exclude<WorkspaceRole, "owner">;
export type ConnectionCapability = "view" | "read" | "use" | "manage";
export type ConflictResolution = "server" | "candidate" | "dismissed";
export type ProviderResourceKind =
  | "organizations"
  | "projects"
  | "databases"
  | "branches"
  | "instances"
  | "brokers"
  | "targets";
export type ProviderSelectionKey =
  | "organization"
  | "project"
  | "database"
  | "branch"
  | "instance"
  | "engine"
  | "networkMode"
  | "broker"
  | "target";
export type EnvironmentClassification = "development" | "production";
export type NeonPlanAction = "planCreate" | "planDelete" | "planSwitch";
export type NeonDecideAction = "decideCreate" | "decideDelete" | "decideSwitch";
export type NeonExecuteAction = "executeCreate" | "executeDelete" | "executeSwitch";
export type NeonDecision = "approved" | "rejected";
export type GcpSetupInventoryKind = "projects" | "instances" | "permissions";
export type OAuthProvider = "planetScale" | "gcpCloudSql";

export interface VaultAppRoleConfiguration {
  address: string;
  namespace: string | null;
  authMount: string;
  roleId: string;
  secretId: string;
  databaseMount: string;
  databaseConnection: string;
  readRole: string;
  writeRole: string | null;
  target: {
    host: string;
    port: number;
    database: string;
    engine: "postgres" | "mysql";
    production: boolean;
  };
}

export type WorkspaceAdminOperation =
  | { kind: "listAccountSessions" }
  | { kind: "revokeAccountSession"; sessionId: string }
  | { kind: "listWorkspaces" }
  | { kind: "createWorkspace"; name: string }
  | { kind: "listMembers"; workspaceId: WorkspaceId }
  | {
      kind: "inviteMember";
      workspaceId: WorkspaceId;
      email: string;
      role: AssignableWorkspaceRole;
    }
  | {
      kind: "changeMemberRole";
      workspaceId: WorkspaceId;
      memberId: string;
      role: AssignableWorkspaceRole;
    }
  | { kind: "removeMember"; workspaceId: WorkspaceId; memberId: string }
  | { kind: "cancelInvitation"; workspaceId: WorkspaceId; invitationId: string }
  | { kind: "listConnections"; workspaceId: WorkspaceId }
  | { kind: "listConnectionGrants"; workspaceId: WorkspaceId; connectionId: string }
  | {
      kind: "grantConnectionAccess";
      workspaceId: WorkspaceId;
      connectionId: string;
      memberId: string;
      capability: ConnectionCapability;
    }
  | {
      kind: "removeConnectionAccess";
      workspaceId: WorkspaceId;
      connectionId: string;
      memberId: string;
    }
  | {
      kind: "setTeamReadAccess";
      workspaceId: WorkspaceId;
      connectionId: string;
      enabled: boolean;
    }
  | { kind: "listConnectionConflicts"; workspaceId: WorkspaceId }
  | {
      kind: "resolveConnectionConflict";
      workspaceId: WorkspaceId;
      conflictId: string;
      resolution: ConflictResolution;
    }
  | {
      kind: "applyConnectionCandidate";
      workspaceId: WorkspaceId;
      connectionId: string;
      expectedRevision: number;
      payload: Record<string, unknown>;
    }
  | {
      kind: "deleteSharedConnection";
      workspaceId: WorkspaceId;
      connectionId: string;
      expectedRevision: number;
    }
  | { kind: "getLifecycle"; workspaceId: WorkspaceId }
  | {
      kind: "scheduleWorkspaceDeletion";
      workspaceId: WorkspaceId;
      requestId: string;
      confirmation: string;
    }
  | { kind: "cancelWorkspaceDeletion"; workspaceId: WorkspaceId; requestId: string }
  | { kind: "listBackups"; workspaceId: WorkspaceId }
  | { kind: "createBackup"; workspaceId: WorkspaceId }
  | { kind: "deleteBackup"; workspaceId: WorkspaceId; backupId: string }
  | {
      kind: "restoreBackup";
      workspaceId: WorkspaceId;
      backupId: string;
      expectedRevision: number;
    }
  | { kind: "getKeyRotation"; workspaceId: WorkspaceId }
  | { kind: "rotateKey"; workspaceId: WorkspaceId; requestId: string }
  | {
      kind: "listProviderIntegrations";
      workspaceId: WorkspaceId;
      includeManagedConnections: boolean;
    }
  | {
      kind: "connectNeon";
      workspaceId: WorkspaceId;
      apiKey: string;
      projectId: string | null;
      organizationId: string | null;
    }
  | {
      kind: "connectVault";
      workspaceId: WorkspaceId;
      configuration: VaultAppRoleConfiguration;
    }
  | {
      kind: "saveGcpIntegration";
      workspaceId: WorkspaceId;
      setupId: string;
      bootstrapTicket: string;
      repairIntegrationId: string | null;
    }
  | {
      kind: "disconnectProviderIntegration";
      workspaceId: WorkspaceId;
      integrationId: string;
    }
  | {
      kind: "listProviderResources";
      workspaceId: WorkspaceId;
      integrationId: string;
      resourceKind: ProviderResourceKind;
      selection: Partial<Record<ProviderSelectionKey, string>>;
    }
  | {
      kind: "claimProviderResource";
      workspaceId: WorkspaceId;
      integrationId: string;
      selectionProof: string;
    }
  | {
      kind: "importProviderResource";
      workspaceId: WorkspaceId;
      integrationId: string;
      receipt: string;
      idempotencyKey: string;
      name: string;
      productionApproved: boolean;
    }
  | {
      kind: "preflightNeonBootstrap";
      workspaceId: WorkspaceId;
      integrationId: string;
      selectionProof: string;
      environment: EnvironmentClassification | null;
    }
  | {
      kind: "applyNeonBootstrap";
      workspaceId: WorkspaceId;
      integrationId: string;
      plan: string;
      idempotencyKey: string;
      publicAclApproved: boolean;
      productionApproved: boolean;
    }
  | {
      kind: "listNeonBranches";
      workspaceId: WorkspaceId;
      integrationId: string;
      projectId: string;
    }
  | {
      kind: "listNeonBranchOperations";
      workspaceId: WorkspaceId;
      integrationId: string;
    }
  | {
      kind: "planNeonBranchOperation";
      workspaceId: WorkspaceId;
      integrationId: string;
      action: NeonPlanAction;
      request: Record<string, unknown>;
    }
  | {
      kind: "decideNeonBranchOperation";
      workspaceId: WorkspaceId;
      integrationId: string;
      action: NeonDecideAction;
      operationId: string;
      planHash: string;
      decision: NeonDecision;
    }
  | {
      kind: "executeNeonBranchOperation";
      workspaceId: WorkspaceId;
      integrationId: string;
      action: NeonExecuteAction;
      operationId: string;
      planHash: string;
    }
  | { kind: "listGcpSetups"; workspaceId: WorkspaceId }
  | {
      kind: "listGcpSetupInventory";
      workspaceId: WorkspaceId;
      setupId: string;
      inventory: GcpSetupInventoryKind;
      projectId: string | null;
    }
  | {
      kind: "prepareGcpSetup";
      workspaceId: WorkspaceId;
      setupId: string;
      projectId: string;
      projectNumber: string;
      instanceId: string;
      environmentClassification: EnvironmentClassification | null;
      approveProduction: boolean;
      approveIamAuthenticationChange: boolean;
      approveIamRoleGrant: boolean;
      schemaAuthority: { database: string; owner: string } | null;
      approveSchemaDelegation: boolean;
      repairIntegrationId: string | null;
    };

export interface WorkspaceAdminRequest {
  accountId: AccountId;
  operation: WorkspaceAdminOperation;
}

export interface ProviderAuthorizationRequest {
  accountId: AccountId;
  workspaceId: WorkspaceId;
  provider: OAuthProvider;
}

/** Control-plane status and bounded JSON body; error bodies arrive as data. */
export interface WorkspaceAdminResponse {
  status: number;
  body: unknown;
}

/** The exact team workspace and signed-in account every admin read is scoped to. */
export interface WorkspaceAdminScope {
  accountId: AccountId;
  workspaceId: WorkspaceId;
  workspaceName: string;
  role: WorkspaceRole;
  canManage: boolean;
  isOwner: boolean;
}
