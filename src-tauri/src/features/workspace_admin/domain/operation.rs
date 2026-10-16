//! The closed catalog of administration commands the webview may request.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::kernel::identity::{ConnectionId, ProviderIntegrationId, WorkspaceId};

use super::values::{
    AssignableWorkspaceRole, ConflictResolution, ConnectionCapability, EnvironmentClassification,
    GcpSchemaAuthority, GcpSetupInventory, NeonDecideAction, NeonDecision, NeonExecuteAction,
    NeonPlanAction, ProviderResourceKind, ProviderSelectionKey, SecretText,
    VaultAppRoleConfiguration,
};

/// One administration command for the hosted workspace control plane.
#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum WorkspaceAdminOperation {
    ListAccountSessions,
    RevokeAccountSession {
        session_id: Uuid,
    },
    ListWorkspaces,
    CreateWorkspace {
        name: String,
    },
    ListMembers {
        workspace_id: WorkspaceId,
    },
    InviteMember {
        workspace_id: WorkspaceId,
        email: String,
        role: AssignableWorkspaceRole,
    },
    ChangeMemberRole {
        workspace_id: WorkspaceId,
        member_id: Uuid,
        role: AssignableWorkspaceRole,
    },
    RemoveMember {
        workspace_id: WorkspaceId,
        member_id: Uuid,
    },
    CancelInvitation {
        workspace_id: WorkspaceId,
        invitation_id: Uuid,
    },
    ListConnections {
        workspace_id: WorkspaceId,
    },
    ListConnectionGrants {
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
    },
    GrantConnectionAccess {
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
        member_id: Uuid,
        capability: ConnectionCapability,
    },
    RemoveConnectionAccess {
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
        member_id: Uuid,
    },
    SetTeamReadAccess {
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
        enabled: bool,
    },
    ListConnectionConflicts {
        workspace_id: WorkspaceId,
    },
    ResolveConnectionConflict {
        workspace_id: WorkspaceId,
        conflict_id: Uuid,
        resolution: ConflictResolution,
    },
    ApplyConnectionCandidate {
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
        expected_revision: i64,
        payload: Value,
    },
    DeleteSharedConnection {
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
        expected_revision: i64,
    },
    GetLifecycle {
        workspace_id: WorkspaceId,
    },
    ScheduleWorkspaceDeletion {
        workspace_id: WorkspaceId,
        request_id: Uuid,
        confirmation: String,
    },
    CancelWorkspaceDeletion {
        workspace_id: WorkspaceId,
        request_id: Uuid,
    },
    ListBackups {
        workspace_id: WorkspaceId,
    },
    CreateBackup {
        workspace_id: WorkspaceId,
    },
    DeleteBackup {
        workspace_id: WorkspaceId,
        backup_id: Uuid,
    },
    RestoreBackup {
        workspace_id: WorkspaceId,
        backup_id: Uuid,
        expected_revision: i64,
    },
    GetKeyRotation {
        workspace_id: WorkspaceId,
    },
    RotateKey {
        workspace_id: WorkspaceId,
        request_id: Uuid,
    },
    ListProviderIntegrations {
        workspace_id: WorkspaceId,
        include_managed_connections: bool,
    },
    ConnectNeon {
        workspace_id: WorkspaceId,
        api_key: SecretText,
        project_id: Option<String>,
        organization_id: Option<String>,
    },
    ConnectVault {
        workspace_id: WorkspaceId,
        configuration: VaultAppRoleConfiguration,
    },
    SaveGcpIntegration {
        workspace_id: WorkspaceId,
        setup_id: Uuid,
        bootstrap_ticket: String,
        repair_integration_id: Option<ProviderIntegrationId>,
    },
    DisconnectProviderIntegration {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
    },
    ListProviderResources {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
        resource_kind: ProviderResourceKind,
        selection: BTreeMap<ProviderSelectionKey, String>,
    },
    ClaimProviderResource {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
        selection_proof: String,
    },
    ImportProviderResource {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
        receipt: Uuid,
        idempotency_key: String,
        name: String,
        production_approved: bool,
    },
    PreflightNeonBootstrap {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
        selection_proof: String,
        environment: Option<EnvironmentClassification>,
    },
    ApplyNeonBootstrap {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
        plan: String,
        idempotency_key: Uuid,
        public_acl_approved: bool,
        production_approved: bool,
    },
    ListNeonBranches {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
        project_id: String,
    },
    ListNeonBranchOperations {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
    },
    PlanNeonBranchOperation {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
        action: NeonPlanAction,
        request: Value,
    },
    DecideNeonBranchOperation {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
        action: NeonDecideAction,
        operation_id: Uuid,
        plan_hash: String,
        decision: NeonDecision,
    },
    ExecuteNeonBranchOperation {
        workspace_id: WorkspaceId,
        integration_id: ProviderIntegrationId,
        action: NeonExecuteAction,
        operation_id: Uuid,
        plan_hash: String,
    },
    ListGcpSetups {
        workspace_id: WorkspaceId,
    },
    ListGcpSetupInventory {
        workspace_id: WorkspaceId,
        setup_id: Uuid,
        inventory: GcpSetupInventory,
        project_id: Option<String>,
    },
    PrepareGcpSetup {
        workspace_id: WorkspaceId,
        setup_id: Uuid,
        project_id: String,
        project_number: String,
        instance_id: String,
        environment_classification: Option<EnvironmentClassification>,
        approve_production: bool,
        approve_iam_authentication_change: bool,
        approve_iam_role_grant: bool,
        schema_authority: Option<GcpSchemaAuthority>,
        approve_schema_delegation: bool,
        repair_integration_id: Option<ProviderIntegrationId>,
    },
}
