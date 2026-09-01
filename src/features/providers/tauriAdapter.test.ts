import { beforeEach, describe, expect, it, vi } from "vitest";

import adapterSource from "./tauriAdapter.ts?raw";
import authRouteSource from "../../../workspace-cloud/app/api/auth/[...all]/route.ts?raw";
import gcpBootstrapFacadeSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap.ts?raw";
import gcpBootstrapApplicationSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-application.ts?raw";
import gcpBootstrapCoreSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-core.ts?raw";
import gcpBootstrapDatabaseSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-database.ts?raw";
import gcpBootstrapIamSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-iam.ts?raw";
import gcpBootstrapSqlSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-sql.ts?raw";
import gcpCloudSqlSource from "../../../workspace-cloud/lib/providers/gcp-cloud-sql.ts?raw";
import vaultProviderSource from "../../../workspace-cloud/lib/providers/vault.ts?raw";
import boundedJsonResponseSource from "../../../workspace-cloud/lib/bounded-json-response.ts?raw";
import neonFacadeSource from "../../../workspace-cloud/lib/providers/neon.ts?raw";
import neonApiSource from "../../../workspace-cloud/lib/providers/neon-api.ts?raw";
import neonBranchApiSource from "../../../workspace-cloud/lib/providers/neon-branch-api.ts?raw";
import neonManagedAccessSource from "../../../workspace-cloud/lib/providers/neon-managed-access.ts?raw";
import neonBranchesSource from "../../../workspace-cloud/lib/providers/neon-branches.ts?raw";
import neonCoreSource from "../../../workspace-cloud/lib/providers/neon-core.ts?raw";
import neonBootstrapSource from "../../../workspace-cloud/lib/providers/neon-bootstrap.ts?raw";
import neonBootstrapRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/[integrationId]/neon-bootstrap/route.ts?raw";
import gcpSetupRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/gcp-setup/[setupId]/route.ts?raw";
import gcpOAuthSource from "../../../workspace-cloud/lib/providers/gcp-cloud-oauth.ts?raw";
import managedLeaseRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/lease/route.ts?raw";
import managedAccessRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/managed-access/route.ts?raw";
import connectionGrantsRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/grants/route.ts?raw";
import providerIntegrationRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/route.ts?raw";
import providerIntegrationDomainSource from "../../../workspace-cloud/lib/provider-integrations/domain.ts?raw";
import providerIntegrationSource from "../../../workspace-cloud/lib/provider-integrations/integration.ts?raw";
import providerDiscoveryProofSource from "../../../workspace-cloud/lib/provider-discovery-proof.ts?raw";
import providerLeaseCleanupSource from "../../../workspace-cloud/lib/provider-integrations/lease-cleanup.ts?raw";
import providerLeaseIssuanceSource from "../../../workspace-cloud/lib/provider-integrations/lease-issuance.ts?raw";
import gcpSetupSource from "../../../workspace-cloud/features/providerAccess/GcpCloudSetup.tsx?raw";
import providerIntegrationListSource from "../../../workspace-cloud/features/providerAccess/ProviderIntegrationList.tsx?raw";
import providerResourcePickerSource from "../../../workspace-cloud/features/providerAccess/ProviderResourcePicker.tsx?raw";
import neonBranchManagerSource from "../../../workspace-cloud/features/providerAccess/NeonBranchManager.tsx?raw";
import sharedDatabaseControllerSource from "../../../workspace-cloud/features/providerAccess/useSharedDatabaseAccess.ts?raw";
import neonProviderBootstrapControllerSource from "../../../workspace-cloud/features/providerAccess/useNeonProviderBootstrap.ts?raw";
import providerAccessDomainSource from "../../../workspace-cloud/features/providerAccess/domain.ts?raw";
import sharedDatabasePanelSource from "../../../workspace-cloud/app/settings/SharedDatabasePanel.tsx?raw";
import connectionAccessPanelSource from "../../../workspace-cloud/app/settings/ConnectionAccessPanel.tsx?raw";
import legacyProviderBackupSource from "../../../workspace-cloud/fixtures/provider-legacy-connection-backup-v1.json?raw";
import providerCatalogSource from "../../../workspace-cloud/lib/provider-catalog.ts?raw";
import workspaceMessagesSource from "../../../workspace-cloud/lib/workspace-messages.ts?raw";
import workspaceServerLogSource from "../../../workspace-cloud/lib/workspace-server-log.ts?raw";
import providerAdapterContractSource from "../../../workspace-cloud/lib/providers/adapter-contract.ts?raw";
import {
  issueAfterFreshProviderAuthority,
  MANAGED_PROVIDER_AUTHORITY_TIMEOUT_MS,
  verifiedProviderAuditId,
} from "../../../workspace-cloud/lib/providers/provider-types";
import providerImportProjectionSource from "../../../workspace-cloud/lib/providers/import-projection.ts?raw";
import providerImportStoreSource from "../../../workspace-cloud/lib/provider-import-store.ts?raw";
import providerLocalTargetSource from "../../../workspace-cloud/lib/provider-local-target.ts?raw";
import providerProvisioningTargetSource from "../../../workspace-cloud/lib/provider-provisioning-target.ts?raw";
import providerResourcesRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/[integrationId]/resources/route.ts?raw";
import neonBranchesRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/[integrationId]/neon-branches/route.ts?raw";
import neonBranchOperationsRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/[integrationId]/neon-branches/operations/route.ts?raw";
import neonBranchOperationsApplicationEntrySource from "../../../workspace-cloud/lib/providers/neon-branch-operation-application.ts?raw";
import neonBranchOperationsContractsSource from "../../../workspace-cloud/lib/providers/neon-branch-operations/contracts.ts?raw";
import neonBranchOperationsCreateSource from "../../../workspace-cloud/lib/providers/neon-branch-operations/create.ts?raw";
import neonBranchOperationsDeleteSource from "../../../workspace-cloud/lib/providers/neon-branch-operations/delete.ts?raw";
import neonBranchOperationsInventorySource from "../../../workspace-cloud/lib/providers/neon-branch-operations/inventory.ts?raw";
import neonBranchOperationsLiveContextsSource from "../../../workspace-cloud/lib/providers/neon-branch-operations/live-contexts.ts?raw";
import neonBranchOperationsSwitchSource from "../../../workspace-cloud/lib/providers/neon-branch-operations/switch.ts?raw";
import neonBranchOperationCommandSource from "../../../workspace-cloud/lib/providers/neon-branch-operation-command.ts?raw";
import managedAccessTargetRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/managed-access-target/route.ts?raw";
import providerOperationStoreFacadeSource from "../../../workspace-cloud/lib/provider-operation-store.ts?raw";
import providerOperationAuthoritySource from "../../../workspace-cloud/lib/provider-operation-authority.ts?raw";
import providerOperationBootstrapSource from "../../../workspace-cloud/lib/provider-operation-bootstrap.ts?raw";
import providerOperationExecutionSource from "../../../workspace-cloud/lib/provider-operation-execution.ts?raw";
import providerOperationManagedAccessSource from "../../../workspace-cloud/lib/provider-operation-managed-access.ts?raw";
import providerOperationPlanSource from "../../../workspace-cloud/lib/provider-operation-plan.ts?raw";
import providerOperationReconciliationSource from "../../../workspace-cloud/lib/provider-operation-reconciliation.ts?raw";
import providerOperationRecordsSource from "../../../workspace-cloud/lib/provider-operation-records.ts?raw";
import providerOperationSwitchSource from "../../../workspace-cloud/lib/provider-operation-switch.ts?raw";
import providerOperationMarkerSource from "../../../workspace-cloud/lib/provider-operation-marker.ts?raw";
import providerOperationMigrationSource from "../../../workspace-cloud/drizzle/0016_first_changeling.sql?raw";
import providerOperationKindMigrationSource from "../../../workspace-cloud/drizzle/0017_lying_hex.sql?raw";
import providerOperationSwitchMigrationSource from "../../../workspace-cloud/drizzle/0018_lowly_magneto.sql?raw";
import workspaceBackupCoreSource from "../../../workspace-cloud/lib/workspace-backup-core.ts?raw";
import workspaceBackupSource from "../../../workspace-cloud/lib/workspace-backup.ts?raw";
import workspaceDataKeySource from "../../../workspace-cloud/lib/workspace-data-key.ts?raw";
import workspaceDataKeyRotationSource from "../../../workspace-cloud/lib/workspace-data-key-rotation.ts?raw";
import workspaceKmsSource from "../../../workspace-cloud/lib/workspace-kms.ts?raw";
import workspaceDataKeyMigrationSource from "../../../workspace-cloud/drizzle/0022_dark_darwin.sql?raw";
import workspaceBackupRotationMigrationSource from "../../../workspace-cloud/drizzle/0023_military_joseph.sql?raw";
import workspaceLifecycleMigrationSource from "../../../workspace-cloud/drizzle/0025_tired_lord_hawal.sql?raw";
import workspaceLifecycleSource from "../../../workspace-cloud/lib/workspace-lifecycle.ts?raw";
import workspaceAuthorizationSource from "../../../workspace-cloud/lib/workspace-authorization.ts?raw";
import workspaceLifecycleRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/lifecycle/route.ts?raw";
import workspaceLifecyclePanelSource from "../../../workspace-cloud/app/settings/WorkspaceLifecyclePanel.tsx?raw";
import workspaceConnectionsSource from "../../../workspace-cloud/lib/workspace-connections.ts?raw";
import workspacePermissionsSource from "../../../workspace-cloud/lib/workspace-permissions.ts?raw";
import workspaceRevocationGatesSource from "../../../workspace-cloud/lib/revocation-gates.ts?raw";
import workspaceSchemaSource from "../../../workspace-cloud/lib/schema.ts?raw";
import workspaceVersioningStoreSource from "../../../workspace-cloud/lib/workspace-versioning-store.ts?raw";
import workspaceSettingsNavigationSource from "../../../workspace-cloud/app/settings/SettingsNavigation.tsx?raw";
import safetySettingsScreenSource from "../../../src/screens/Settings/Safety/index.tsx?raw";
import desktopSharedConnectionSource from "../../../src-tauri/src/features/workspaces/adapters/control_plane/connections.rs?raw";
import desktopControlPlaneSource from "../../../src-tauri/src/features/workspaces/adapters/control_plane.rs?raw";
import hostedControlPlaneSource from "../../../src-tauri/src/hosted_control_plane.rs?raw";
import {
  neonBranchQueryable,
  parseNeonBranchInventory,
} from "../../../workspace-cloud/lib/providers/neon-branches";
import {
  buildNeonBranchCreatePlan,
  parseNeonBranchCreatePlanRequest,
  revalidateNeonBranchCreatePlan,
} from "../../../workspace-cloud/lib/providers/neon-branch-plan";
import { parseNeonBranchOperationCommand } from "../../../workspace-cloud/lib/providers/neon-branch-operation-command";
import {
  buildNeonBranchDeletePlan,
  revalidateNeonBranchDeletePlan,
} from "../../../workspace-cloud/lib/providers/neon-branch-delete-plan";
import {
  buildNeonBranchSwitchPlan,
  parseNeonBranchSwitchPlanRequest,
  revalidateNeonBranchSwitchPlan,
} from "../../../workspace-cloud/lib/providers/neon-branch-switch-plan";
import {
  neonBranchMutationBody,
  parseNeonBranchCreateReceipt,
  parseNeonBranchDeleteReceipt,
} from "../../../workspace-cloud/lib/providers/neon-branch-mutation";
import {
  neonInheritedRoleRetirementStatement,
} from "../../../workspace-cloud/lib/providers/neon-role-policy";
import {
  deriveNeonSafeRun,
  parseNeonBranchInventory as parseNeonBranchInventoryResponse,
  parseNeonBranchOperations,
} from "../../../workspace-cloud/features/providerAccess/neonBranches";

const neonBranchOperationsApplicationSource = [
  neonBranchOperationsApplicationEntrySource,
  neonBranchOperationsContractsSource,
  neonBranchOperationsInventorySource,
  neonBranchOperationsLiveContextsSource,
  // Preserve lifecycle order for the raw-source safety assertions below.
  neonBranchOperationsSwitchSource,
  neonBranchOperationsDeleteSource,
  neonBranchOperationsCreateSource,
].join("\n");

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

import {
  parseProviderProvisioningPlan,
  parseProviderProvisioningDriverStatus,
  providerBindingId,
  providerCredentialReceiptId,
  providerIntegrationId,
} from "./domain";
import {
  beginProviderCredentialBinding,
  discoverProviderProvisioningTargets,
  listProviderCredentialBindings,
  listProviderIntegrations,
  revokeProviderCredentialBinding,
  verifyProviderCredentialBinding,
} from "./tauriAdapter";

const gcpBootstrapSource = [
  gcpBootstrapFacadeSource,
  gcpBootstrapApplicationSource,
  gcpBootstrapCoreSource,
  gcpBootstrapDatabaseSource,
  gcpBootstrapIamSource,
  gcpBootstrapSqlSource,
].join("\n");
const neonSource = [
  neonFacadeSource,
  neonApiSource,
  neonBranchApiSource,
  neonManagedAccessSource,
].join("\n");
const providerOperationStoreSource = [
  providerOperationStoreFacadeSource,
  providerOperationRecordsSource,
  providerOperationManagedAccessSource,
  providerOperationAuthoritySource,
  providerOperationBootstrapSource,
  providerOperationPlanSource,
  providerOperationExecutionSource,
  providerOperationReconciliationSource,
  providerOperationSwitchSource,
].join("\n");

const integrationId = "11111111-1111-4111-8111-111111111111";
const bindingId = "22222222-2222-4222-8222-222222222222";
const receiptId = "33333333-3333-4333-8333-333333333333";
const connectionId = "55555555-5555-4555-8555-555555555555";
const discoveryId = "66666666-6666-4666-8666-666666666666";
const integration = {
  id: integrationId,
  provider: "gcpCloudSql",
  displayName: "Google Cloud SQL",
  integrationGeneration: "12",
  credentialMethod: "adcWif",
  state: "ready",
};

const binding = {
  id: bindingId,
  integrationId,
  provider: "gcpCloudSql",
  integrationGeneration: "12",
  state: "ready",
  updatedAt: "2026-07-27T00:00:00.000Z",
};

describe("provider credential Tauri adapter", () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => invokeMock.mockReset());

  it("owns the exact summary-only command wire", async () => {
    invokeMock
      .mockResolvedValueOnce([integration])
      .mockResolvedValueOnce([binding])
      .mockResolvedValueOnce([{
        discoveryId,
        provider: "neon",
        displayName: "Neon app",
        detail: "quiet-sun / main",
        engine: "postgres",
        production: false,
        expiresAt: "2026-08-05T00:05:00.000Z",
      }])
      .mockResolvedValueOnce({ receiptId, expiresAt: "2026-07-27T00:05:00.000Z" })
      .mockResolvedValueOnce(binding)
      .mockResolvedValueOnce(undefined);

    await expect(listProviderIntegrations()).resolves.toEqual([
      expect.objectContaining({ id: providerIntegrationId(integrationId) }),
    ]);
    await expect(listProviderCredentialBindings()).resolves.toEqual([
      expect.objectContaining({ id: providerBindingId(bindingId) }),
    ]);
    await expect(discoverProviderProvisioningTargets("neon", connectionId)).resolves.toEqual([
      expect.objectContaining({ discoveryId }),
    ]);
    await beginProviderCredentialBinding({
      integrationId: providerIntegrationId(integrationId),
      credential: { type: "gcpAdc" },
    });
    await verifyProviderCredentialBinding({
      receiptId: providerCredentialReceiptId(receiptId),
    });
    await revokeProviderCredentialBinding(providerBindingId(bindingId));

    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_provider_integrations");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_provider_credential_bindings");
    expect(invokeMock).toHaveBeenNthCalledWith(3, "discover_provider_provisioning_targets", {
      provider: "neon",
      connectionId,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "begin_provider_credential_binding", {
      integrationId,
      credential: { type: "gcpAdc" },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "verify_provider_credential_binding", {
      receiptId,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(6, "revoke_provider_credential_binding", { id: bindingId });
  });

  it("accepts only the exact receipt DTO including a valid expiry timestamp", async () => {
    invokeMock.mockResolvedValueOnce({
      receiptId,
      expiresAt: "2026-07-27T00:05:00.000Z",
      integrationId,
    });
    await expect(beginProviderCredentialBinding({
      integrationId: providerIntegrationId(integrationId),
      credential: { type: "gcpAdc" },
    })).rejects.toThrow("Invalid provider credential receipt");

    invokeMock.mockResolvedValueOnce({ receiptId, expiresAt: "not-a-timestamp" });
    await expect(beginProviderCredentialBinding({
      integrationId: providerIntegrationId(integrationId),
      credential: { type: "gcpAdc" },
    })).rejects.toThrow("Invalid provider credential receipt expiry");

    invokeMock.mockResolvedValueOnce({ receiptId, expiresAt: "2026-07-27T00:05:00.000Z" });
    await beginProviderCredentialBinding({
      integrationId: providerIntegrationId(integrationId),
      credential: { type: "gcpAdc" },
    });
    expect(invokeMock).toHaveBeenLastCalledWith("begin_provider_credential_binding", {
      integrationId,
      credential: { type: "gcpAdc" },
    });
  });

  it("rejects extra or missing integration and binding fields before a query cache can hold them", async () => {
    expect(parseProviderProvisioningDriverStatus({
      provider: "neon",
      prerequisiteKind: "workspaceIntegration",
      prerequisiteName: "Workspace integration",
      minimumVersion: null,
      installedVersion: null,
      activeIdentity: null,
      readiness: "ready",
    })).toEqual(expect.objectContaining({
      provider: "neon",
      prerequisiteKind: "workspaceIntegration",
      readiness: "ready",
    }));
    expect(() => parseProviderProvisioningDriverStatus({
      provider: "neon",
      cliName: "Neon CLI",
      minimumVersion: "1.0.0",
      installedVersion: "1.0.0",
      activeAccount: "owner",
      readiness: "ready",
    })).toThrow("Invalid provider provisioning status");
    expect(() => parseProviderProvisioningDriverStatus({
      provider: "neon",
      prerequisiteKind: "workspaceIntegration",
      prerequisiteName: "Workspace integration",
      minimumVersion: null,
      installedVersion: null,
      activeIdentity: null,
      readiness: "loggedOut",
    })).toThrow("Invalid provider prerequisite status");

    invokeMock.mockResolvedValueOnce([{ ...integration, token: "must-not-pass" }]);
    await expect(listProviderIntegrations()).rejects.toThrow("Invalid provider integration summary");

    const { displayName: _displayName, ...missingIntegration } = integration;
    invokeMock.mockResolvedValueOnce([missingIntegration]);
    await expect(listProviderIntegrations()).rejects.toThrow("Invalid provider integration summary");

    invokeMock.mockResolvedValueOnce([{ ...binding, principal: "must-not-pass" }]);
    await expect(listProviderCredentialBindings()).rejects.toThrow("Invalid provider credential binding summary");

    const { updatedAt: _updatedAt, ...missingBinding } = binding;
    invokeMock.mockResolvedValueOnce([missingBinding]);
    await expect(listProviderCredentialBindings()).rejects.toThrow("Invalid provider credential binding summary");

    invokeMock.mockResolvedValueOnce([{ ...integration, integrationGeneration: "12.0" }]);
    await expect(listProviderIntegrations()).rejects.toThrow("Invalid provider integration generation");

    invokeMock.mockResolvedValueOnce([{ ...integration, state: "revoked" }]);
    await expect(listProviderIntegrations()).rejects.toThrow("Invalid provider credential state");

    invokeMock.mockResolvedValueOnce([{ ...binding, state: "credentialsRequired" }]);
    await expect(listProviderCredentialBindings()).rejects.toThrow("Invalid provider binding state");

    const provisioningPlan = {
      receiptId,
      operationId: "44444444-4444-4444-8444-444444444444",
      connectionId: "55555555-5555-4555-8555-555555555555",
      provider: "gcpCloudSql",
      targetDisplayName: "sample-db-dev / app",
      targetDetail: "sample-project-123 · asia-northeast3",
      engine: "postgres",
      intent: "apply",
      access: "read",
      production: false,
      state: "readyToApply",
      phase: "approve",
      operationState: "pending_approval",
      payloadHash: "ab".repeat(32),
      confirmationPhrase: null,
      completedSteps: 0,
      totalSteps: 2,
      actions: ["createProviderIdentity", "grantExistingObjects"],
      repairReason: null,
      canExecute: false,
      canCancel: false,
      canDestroy: false,
    };
    expect(parseProviderProvisioningPlan(provisioningPlan)).toEqual(provisioningPlan);
    expect(() => parseProviderProvisioningPlan({
      ...provisioningPlan,
      cliArgv: ["projects", "add-iam-policy-binding"],
    })).toThrow("Invalid provider provisioning plan");
    expect(() => parseProviderProvisioningPlan({
      ...provisioningPlan,
      payloadHash: "not-a-hash",
    })).toThrow("Invalid provider provisioning hash");
    expect(() => parseProviderProvisioningPlan({
      ...provisioningPlan,
      operationState: "pendingApproval",
    })).toThrow("Invalid provider operation state");
  });

  it("prohibits legacy provider identity and manual GCP trust input", async () => {
    expect(neonInheritedRoleRetirementStatement(
      "dopedb_member01_1234567890abcdef1234567890abcdef",
    )).toBe(
      'ALTER ROLE "dopedb_member01_1234567890abcdef1234567890abcdef" '
        + "NOLOGIN PASSWORD NULL VALID UNTIL 'epoch'",
    );
    expect(() => neonInheritedRoleRetirementStatement(
      "dopedb_policy_1234567890abcdef",
    )).toThrow("Invalid Neon lease role");
    const branchRow = {
      project_id: "project-one",
      current_state: "ready",
      pending_state: null,
      state_changed_at: "2026-08-05T01:00:00Z",
      created_at: "2026-08-05T00:00:00Z",
      updated_at: "2026-08-05T01:00:00Z",
      creation_source: "api",
      init_source: "parent-data",
      default: false,
      protected: false,
    };
    const branchInventory = parseNeonBranchInventory("project-one", [
      {
        ...branchRow,
        id: "br-main",
        name: "main",
        default: true,
        protected: true,
      },
      {
        ...branchRow,
        id: "br-child",
        parent_id: "br-main",
        parent_lsn: "0/1DE2850",
        name: "agent-checkpoint",
      },
      {
        ...branchRow,
        id: "br-schema",
        parent_id: "br-main",
        parent_timestamp: "2026-08-05T00:30:00Z",
        name: "schema-only",
        current_state: "init",
        pending_state: "provider-future-state",
        init_source: "schema-only",
        expires_at: "2026-08-06T00:00:00Z",
        restricted_actions: [{ name: "restore", reason: "Restore is unavailable" }],
      },
      {
        ...branchRow,
        id: "br-archived",
        parent_id: "br-main",
        name: "archived-preview",
        current_state: "archived",
      },
    ]);
    expect(branchInventory.rootIds).toEqual(["br-main", "br-schema"]);
    expect(branchInventory.branches.map((branch) => branch.id)).toEqual([
      "br-main",
      "br-child",
      "br-archived",
      "br-schema",
    ]);
    expect(branchInventory.branches[1]).toMatchObject({
      parentId: "br-main",
      treeParentId: "br-main",
      sourceLsn: "0/1DE2850",
      depth: 1,
      production: false,
      ready: true,
    });
    expect(branchInventory.branches[3]).toMatchObject({
      parentId: "br-main",
      treeParentId: null,
      initSource: "schema-only",
      pendingState: "unknown",
      depth: 0,
      ready: false,
    });
    expect(branchInventory.branches[2]).toMatchObject({
      currentState: "archived",
      ready: false,
    });
    expect(neonBranchQueryable(branchInventory.branches[2])).toBe(true);
    expect(() => parseNeonBranchInventory("project-one", [{
      ...branchRow,
      id: "br-orphan",
      parent_id: "br-missing",
      name: "orphan",
    }])).toThrow("Neon branch hierarchy is inconsistent");
    expect(() => parseNeonBranchInventory("project-one", [
      { ...branchRow, id: "br-cycle-a", parent_id: "br-cycle-b", name: "a" },
      { ...branchRow, id: "br-cycle-b", parent_id: "br-cycle-a", name: "b" },
    ])).toThrow("Neon branch hierarchy contains a cycle");
    expect(() => parseNeonBranchInventory("project-one", [{
      ...branchRow,
      id: "br-duplicate-action",
      name: "duplicate",
      restricted_actions: [
        { name: "restore", reason: "one" },
        { name: "restore", reason: "two" },
      ],
    }])).toThrow("Neon returned an invalid branch inventory");
    const productionPlanRequest = parseNeonBranchCreatePlanRequest({
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
      projectId: "project-one",
      sourceBranchId: "br-main",
      targetName: "safe-production-checkpoint",
      initSource: "parent-data",
      sourcePoint: { kind: "head" },
      endpoint: "read_write",
      sourceEnvironment: "production",
    });
    const productionPlan = buildNeonBranchCreatePlan({
      request: productionPlanRequest,
      inventory: branchInventory,
      operationId: "88888888-8888-4888-8888-888888888888",
      integrationId,
      integrationGeneration: 12n,
      workspaceProductionReference: true,
      now: new Date("2026-08-05T02:00:00Z"),
    });
    expect(productionPlan).toMatchObject({
      risk: "production_data",
      approvalPolicy: "separate_admin",
      target: {
        copiesData: true,
        createsCompute: true,
        protected: false,
        expiresAt: null,
      },
    });
    expect(productionPlan.warningCodes).toEqual([
      "NEON_PRODUCTION_DATA_COPY",
      "NEON_PROTECTED_PARENT_CREDENTIALS_ROTATE",
      "NEON_ENDPOINT_CREATES_COMPUTE",
      "NEON_INHERITED_DOPEDB_CREDENTIALS_RETIRED",
      "NEON_HEAD_RESOLVED_AT_EXECUTION",
    ]);
    const developmentPlan = buildNeonBranchCreatePlan({
      request: parseNeonBranchCreatePlanRequest({
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        projectId: "project-one",
        sourceBranchId: "br-child",
        targetName: "safe-development-branch",
        initSource: "parent-data",
        sourcePoint: { kind: "head" },
        endpoint: "read_write",
        sourceEnvironment: "development",
      }),
      inventory: branchInventory,
      operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      integrationId,
      integrationGeneration: 12n,
      workspaceProductionReference: false,
      now: new Date("2026-08-05T02:00:00Z"),
    });
    expect(developmentPlan.warningCodes).toContain(
      "NEON_INHERITED_DOPEDB_CREDENTIALS_RETIRED",
    );
    expect(developmentPlan.warningCodes).not.toContain(
      "NEON_PROTECTED_PARENT_CREDENTIALS_ROTATE",
    );
    const mutationPlanHash = "a".repeat(64);
    const mutationOwnership = `v1.${"B".repeat(43)}`;
    expect(neonBranchMutationBody({
      plan: productionPlan,
      planHash: mutationPlanHash,
      ownershipMarker: mutationOwnership,
    })).toEqual({
      branch: {
        parent_id: "br-main",
        name: "safe-production-checkpoint",
        init_source: "parent-data",
        protected: false,
      },
      endpoints: [{ type: "read_write" }],
      annotation_value: {
        "dopedb-operation-id": productionPlan.operationId,
        "dopedb-plan-hash": mutationPlanHash,
        "dopedb-ownership": mutationOwnership,
      },
    });
    const redactedReceipt = parseNeonBranchCreateReceipt({
      branch: {
        id: "br-created",
        project_id: "project-one",
        name: "safe-production-checkpoint",
      },
      operations: [{
        id: "12345678-1234-4234-8234-123456789012",
        project_id: "project-one",
        branch_id: "br-created",
        action: "create_timeline",
        status: "running",
      }],
      endpoints: [{
        id: "ep-created",
        branch_id: "br-created",
        type: "read_write",
      }],
      roles: [{ name: "owner", password: "must-not-survive" }],
      connection_uris: [{ connection_uri: "postgres://must-not-survive" }],
    }, productionPlan);
    expect(redactedReceipt).toEqual({
      branchId: "br-created",
      providerOperationId: "12345678-1234-4234-8234-123456789012",
      providerOperationStatus: "running",
      endpointId: "ep-created",
    });
    expect(JSON.stringify(redactedReceipt)).not.toContain("must-not-survive");
    expect(revalidateNeonBranchCreatePlan({
      plan: productionPlan,
      inventory: branchInventory,
      workspaceProductionReference: true,
      now: new Date("2026-08-05T02:01:00Z"),
    })).toBe(productionPlan);
    expect(() => revalidateNeonBranchCreatePlan({
      plan: productionPlan,
      inventory: {
        ...branchInventory,
        branches: branchInventory.branches.map((branch) => (
          branch.id === productionPlan.source.branchId
            ? { ...branch, updatedAt: "2026-08-05T02:00:30Z" }
            : branch
        )),
      },
      workspaceProductionReference: true,
      now: new Date("2026-08-05T02:01:00Z"),
    })).toThrow("Neon source branch changed after planning");
    expect(() => revalidateNeonBranchCreatePlan({
      plan: productionPlan,
      inventory: branchInventory,
      workspaceProductionReference: true,
      now: new Date("2026-08-05T02:10:00Z"),
    })).toThrow("Neon branch create plan expired");
    expect(() => buildNeonBranchCreatePlan({
      request: { ...productionPlanRequest, sourceEnvironment: "development" },
      inventory: branchInventory,
      operationId: "88888888-8888-4888-8888-888888888888",
      integrationId,
      integrationGeneration: 12n,
      workspaceProductionReference: false,
      now: new Date("2026-08-05T02:00:00Z"),
    })).toThrow("Neon production source cannot be downgraded");
    const schemaOnlyPlan = buildNeonBranchCreatePlan({
      request: parseNeonBranchCreatePlanRequest({
        idempotencyKey: "99999999-9999-4999-8999-999999999999",
        projectId: "project-one",
        sourceBranchId: "br-child",
        targetName: "schema-sandbox",
        initSource: "schema-only",
        sourcePoint: { kind: "timestamp", value: "2026-08-05T01:30:00Z" },
        endpoint: "none",
        sourceEnvironment: "development",
      }),
      inventory: branchInventory,
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      integrationId,
      integrationGeneration: 12n,
      workspaceProductionReference: false,
      now: new Date("2026-08-05T02:00:00Z"),
    });
    expect(schemaOnlyPlan).toMatchObject({
      risk: "standard",
      approvalPolicy: "single_admin",
      target: { copiesData: false, createsCompute: false },
    });
    expect(schemaOnlyPlan.warningCodes).toEqual(["NEON_SCHEMA_ONLY_HAS_NO_DATA"]);
    expect(() => revalidateNeonBranchCreatePlan({
      plan: schemaOnlyPlan,
      inventory: branchInventory,
      workspaceProductionReference: true,
      now: new Date("2026-08-05T02:01:00Z"),
    })).toThrow("Neon production source cannot be downgraded");
    expect(() => parseNeonBranchCreatePlanRequest({
      ...productionPlanRequest,
      sourcePoint: { kind: "lsn", value: "not-an-lsn" },
    })).toThrow("Invalid Neon branch create plan request");
    expect(() => parseNeonBranchCreatePlanRequest({
      ...productionPlanRequest,
      optimisticExpiry: true,
    })).toThrow("Invalid Neon branch create plan request");

    const deleteOwnership = {
      operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      state: "succeeded",
      planHash: "d".repeat(64),
      ownershipMarker: `v1.${"D".repeat(43)}`,
      branchId: "br-child",
    };
    const deletePlan = buildNeonBranchDeletePlan({
      request: {
        idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        projectId: "project-one",
        branchId: "br-child",
      },
      inventory: branchInventory,
      ownership: deleteOwnership,
      references: {
        connectionCount: 0,
        activeLeaseCount: 0,
        endpointIds: ["ep-safe"],
      },
      operationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      integrationId,
      integrationGeneration: 12n,
      now: new Date("2026-08-05T02:00:00Z"),
    });
    expect(deletePlan).toMatchObject({
      kind: "neon.branch.delete",
      deletionMode: "provider_default_soft_delete",
      risk: "standard",
      approvalPolicy: "single_admin",
      target: { branchId: "br-child", default: false, protected: false },
      references: { connectionCount: 0, activeLeaseCount: 0 },
    });
    expect(JSON.stringify(deletePlan)).not.toContain(deleteOwnership.ownershipMarker);
    expect(revalidateNeonBranchDeletePlan({
      plan: deletePlan,
      inventory: branchInventory,
      ownership: deleteOwnership,
      references: {
        connectionCount: 0,
        activeLeaseCount: 0,
        endpointIds: ["ep-safe"],
      },
      now: new Date("2026-08-05T02:01:00Z"),
    })).toBe(deletePlan);
    expect(() => revalidateNeonBranchDeletePlan({
      plan: deletePlan,
      inventory: branchInventory,
      ownership: deleteOwnership,
      references: {
        connectionCount: 1,
        activeLeaseCount: 0,
        endpointIds: ["ep-safe"],
      },
      now: new Date("2026-08-05T02:01:00Z"),
    })).toThrow("still referenced by workspace authority");
    const deleteReceipt = parseNeonBranchDeleteReceipt({
      branch: {
        id: "br-child",
        project_id: "project-one",
        connection_uri: "postgres://must-not-survive",
      },
      operations: [
        {
          id: "12345678-1234-4234-8234-123456789099",
          project_id: "project-one",
          branch_id: "br-child",
          action: "suspend_compute",
          status: "running",
        },
        {
          id: "12345678-1234-4234-8234-123456789099",
          project_id: "project-one",
          branch_id: "br-child",
          action: "delete_timeline",
          status: "scheduling",
        },
      ],
    }, deletePlan);
    expect(deleteReceipt).toEqual({
      branchId: "br-child",
      providerOperationId: "12345678-1234-4234-8234-123456789099",
      providerOperationStatus: "scheduling",
      alreadyDeleted: false,
    });
    expect(parseNeonBranchDeleteReceipt(null, deletePlan).alreadyDeleted).toBe(true);
    expect(JSON.stringify(deleteReceipt)).not.toContain("must-not-survive");

    const switchInventory = {
      ...branchInventory,
      branches: [
        ...branchInventory.branches,
        {
          ...branchInventory.branches[1],
          id: "br-target",
          name: "agent-target",
          stateChangedAt: "2026-08-05T01:30:00Z",
          updatedAt: "2026-08-05T01:30:00Z",
        },
      ],
    };
    const switchConnection = {
      connectionId,
      connectionName: "Shared development",
      providerResourceId: "12121212-1212-4212-8212-121212121212",
      projectId: "project-one",
      sourceBranchId: "br-child",
      databaseId: "123456789",
      database: "app",
      schemas: ["public"],
      environment: "development" as const,
      readonlyDefault: true,
      allowWrites: true,
      schemaGroup: null,
      contentRevision: 7,
      authorityRevision: 11,
      activeLeaseCount: 2,
    };
    const switchTarget = {
      branch: switchInventory.branches.find((branch) => branch.id === "br-target")!,
      databaseId: "987654321",
      database: "app",
      endpointId: "ep-target",
      databaseFingerprint: "e".repeat(64),
      resourceFingerprint: "f".repeat(64),
      managedAccessOperationId: "13131313-1313-4313-8313-131313131313",
    };
    const switchPlan = buildNeonBranchSwitchPlan({
      request: parseNeonBranchSwitchPlanRequest({
        idempotencyKey: "14141414-1414-4414-8414-141414141414",
        projectId: "project-one",
        connectionId,
        targetBranchId: "br-target",
        targetEnvironment: "development",
      }),
      inventory: switchInventory,
      connection: switchConnection,
      target: switchTarget,
      operationId: "15151515-1515-4515-8515-151515151515",
      integrationId,
      integrationGeneration: 12n,
      now: new Date("2026-08-05T02:00:00Z"),
    });
    const existingBranchSwitchPlan = buildNeonBranchSwitchPlan({
      request: parseNeonBranchSwitchPlanRequest({
        idempotencyKey: "16161616-1616-4616-8616-161616161616",
        projectId: "project-one",
        connectionId,
        targetBranchId: "br-target",
        targetEnvironment: "development",
      }),
      inventory: switchInventory,
      connection: switchConnection,
      target: { ...switchTarget, managedAccessOperationId: null },
      operationId: "17171717-1717-4717-8717-171717171717",
      integrationId,
      integrationGeneration: 12n,
      now: new Date("2026-08-05T02:00:00Z"),
    });
    expect(existingBranchSwitchPlan.target.managedAccessOperationId).toBeNull();
    expect(switchPlan).toMatchObject({
      kind: "neon.branch.switch",
      risk: "standard",
      approvalPolicy: "single_admin",
      source: {
        connectionId,
        branchId: "br-child",
        contentRevision: 7,
        authorityRevision: 11,
      },
      target: { branchId: "br-target", databaseId: "987654321" },
      impact: {
        activeLeaseCount: 2,
        closesExistingSessions: true,
        createsConnectionRevision: true,
        reintrospectionRequired: true,
      },
    });
    expect(revalidateNeonBranchSwitchPlan({
      plan: switchPlan,
      inventory: switchInventory,
      connection: switchConnection,
      target: switchTarget,
      now: new Date("2026-08-05T02:01:00Z"),
    })).toBe(switchPlan);
    expect(() => revalidateNeonBranchSwitchPlan({
      plan: switchPlan,
      inventory: {
        ...switchInventory,
        branches: switchInventory.branches.map((branch) => (
          branch.id === "br-target"
            ? { ...branch, updatedAt: "2026-08-05T02:00:30Z" }
            : branch
        )),
      },
      connection: switchConnection,
      target: switchTarget,
      now: new Date("2026-08-05T02:01:00Z"),
    })).toThrow("target changed after planning");
    expect(() => parseNeonBranchSwitchPlanRequest({
      idempotencyKey: "14141414-1414-4414-8414-141414141414",
      projectId: "project-one",
      connectionId,
      targetBranchId: "br-target",
      targetEnvironment: "development",
      providerToken: "must-not-pass",
    })).toThrow("Invalid Neon branch switch plan request");

    const order: string[] = [];
    await expect(issueAfterFreshProviderAuthority(
      "neon",
      async () => {
        order.push("revalidate");
        return "fresh-proof";
      },
      async (proof) => {
        order.push(`issue:${proof}`);
        return "lease";
      },
    )).resolves.toBe("lease");
    expect(order).toEqual(["revalidate", "issue:fresh-proof"]);
    expect(verifiedProviderAuditId("neon", "branch-id:database-id"))
      .toBe("branch-id:database-id");
    for (const value of ["", "unsafe\nline", "unsafe\u202edirection", "x".repeat(513)]) {
      expect(() => verifiedProviderAuditId("neon", value)).toThrow(
        "Provider returned an invalid audit identifier",
      );
    }

    vi.useFakeTimers();
    let timedOutIssueCalled = false;
    try {
      const pending = issueAfterFreshProviderAuthority(
        "neon",
        () => new Promise<never>(() => undefined),
        async () => {
          timedOutIssueCalled = true;
          return "unsafe-lease";
        },
      );
      const rejection = expect(pending).rejects.toMatchObject({
        provider: "neon",
        status: 504,
      });
      await vi.advanceTimersByTimeAsync(MANAGED_PROVIDER_AUTHORITY_TIMEOUT_MS);
      await rejection;
      expect(timedOutIssueCalled).toBe(false);
    } finally {
      vi.useRealTimers();
    }

    const beginSource = adapterSource.slice(
      adapterSource.indexOf("function beginProviderCredentialBindingPayload"),
      adapterSource.indexOf("export async function listProviderIntegrations"),
    );
    expect(beginSource).not.toMatch(/\b(integrationGeneration|bindingId|kind)\b/);
    expect(providerIntegrationRouteSource).toContain("openProviderBootstrapTicket");
    expect(providerIntegrationRouteSource).not.toContain(
      "parseGcpCloudSqlCredential(body.configuration)",
    );
    expect(gcpSetupSource).toContain("copy.configure");
    expect(workspaceMessagesSource).toContain('configure: "Configure and connect"');
    expect(workspaceMessagesSource).toContain('configure: "자동 설정하고 연결"');
    expect(gcpSetupSource).not.toMatch(
      /workloadIdentityPoolId|workloadIdentityProviderId|readServiceAccountEmail/,
    );
    expect(providerIntegrationListSource).not.toMatch(/availability|"준비 중"/);
    expect(providerIntegrationListSource).toContain("copy.neonDescriptionBeforeLink");
    expect(providerIntegrationListSource).toContain("copy.neonGuide.firstPath");
    expect(providerIntegrationListSource).toContain("neonConfiguration.projectId");
    expect(workspaceMessagesSource).toContain("This is not one-click setup");
    expect(workspaceMessagesSource).toContain("원클릭 연결이 아니며");
    expect(providerIntegrationListSource).toContain(":personal:broad:");
    expect(providerCatalogSource).not.toMatch(
      /supportsReadWrite|availability|awsRds|oracleOci|mongodbAtlas/,
    );
    expect(providerCatalogSource.match(/id: "(planetScale|gcpCloudSql|neon|vault)"/g))
      .toHaveLength(4);
    expect(providerIntegrationListSource).toContain("copy.vaultGuide.caution");
    expect(vaultProviderSource).toContain("env.vaultBrokerOrigins().includes(url.origin)");
    expect(vaultProviderSource).toContain('redirect: "error"');
    expect(vaultProviderSource).toContain("VAULT_MAX_DATABASE_LEASE_SECONDS");
    expect(vaultProviderSource).toContain('"auth/token/revoke-self"');
    expect(providerIntegrationRouteSource).toContain("id: provider.id");
    expect(providerIntegrationRouteSource).not.toContain("...provider,");
    expect(gcpOAuthSource).toContain('"/api/auth/callback/google"');
    expect(authRouteSource).toContain("isGcpCloudSetupCallback");
    expect(gcpBootstrapSource).toContain("verifyVercelOidcToken");
    expect(gcpBootstrapSource).toContain("roles/iam.workloadIdentityUser");
    expect(gcpBootstrapSource).toContain("configureDatabasePrivileges");
    expect(gcpBootstrapSource).toContain("pg_write_all_data");
    expect(gcpBootstrapSource).toContain("roles/serviceusage.serviceUsageConsumer");
    expect(gcpBootstrapSource).toContain("Temporary Cloud SQL privilege bootstrap cleanup failed");
    expect(gcpCloudSqlSource).toContain("logGcpManagedAccessUpstreamRejection");
    expect(gcpCloudSqlSource).toContain("MAX_TRANSIENT_REQUEST_ATTEMPTS = 3");
    expect(gcpCloudSqlSource).toContain("waitForTransientRetry(attempt, deadline)");
    expect(gcpCloudSqlSource).toContain(
      "Google Cloud temporarily could not issue managed database access",
    );
    const gcpLeaseIssuanceSource = gcpCloudSqlSource.slice(
      gcpCloudSqlSource.indexOf("export async function issueGcpCloudSqlLease"),
    );
    expect(gcpLeaseIssuanceSource.match(/federatedToken\(/g)).toHaveLength(1);
    expect(gcpLeaseIssuanceSource).toContain("serviceAccountTokenFromFederation");
    expect(gcpLeaseIssuanceSource).not.toContain("controlPlaneToken(");
    expect(workspaceServerLogSource).toContain(
      'emitServerFailure("gcp_managed_access_upstream_rejection"',
    );
    expect(workspaceServerLogSource).toContain(
      'emitServerFailure("managed_database_access_failed"',
    );
    expect(workspaceServerLogSource).not.toMatch(
      /error\.message|request\.body|response\.body/,
    );
    expect(gcpCloudSqlSource).toContain("Cloud SQL Admin denied the managed access check");
    expect(gcpCloudSqlSource).toContain('"x-goog-user-project": credential.projectId');
    expect(gcpCloudSqlSource).toContain("Cloud SQL instance identity changed during verification");
    expect(gcpCloudSqlSource).toContain("return { providerAuditId: connectionName }");
    expect(gcpCloudSqlSource).not.toContain("iamDatabaseUsersWithToken");
    expect(providerIntegrationDomainSource).toContain('networkMode: "PUBLIC"');
    expect(providerIntegrationDomainSource).not.toContain(
      'networkMode: input.selection.networkMode || "PRIVATE_SERVICES_ACCESS"',
    );
    expect(hostedControlPlaneSource).toContain(".or(value.error.as_deref())");
    expect(gcpSetupRouteSource).toContain("writeAccess: true");
    expect(managedLeaseRouteSource).toContain(
      'let requestedAccessMode: "read" | "write" | "schema"',
    );
    expect(managedLeaseRouteSource).toContain("providerResourceSupportsSchema");
    expect(managedLeaseRouteSource).toContain("providerResourceSupportsWrite");
    expect(managedLeaseRouteSource).toContain("export const maxDuration = 60");
    expect(providerLeaseIssuanceSource.match(
      /issueAfterFreshProviderAuthority\(/g,
    )).toHaveLength(3);
    expect(providerLeaseIssuanceSource).toContain(
      "providerAuditId: verifiedProviderAuditId",
    );
    expect(managedLeaseRouteSource).toContain(
      "providerAuditId: lease.providerAuditId",
    );
    expect(workspaceRevocationGatesSource).toContain(
      'lease."provider_audit_id" = ${providerAuditId}',
    );
    expect(workspaceSchemaSource).toContain(
      'providerAuditId: text("provider_audit_id")',
    );
    expect(providerLeaseCleanupSource).toContain(
      "'credential.lease.cleanup_deferred'",
    );
    expect(providerLeaseCleanupSource).toContain(
      "'providerAuditId', deferred.\"provider_audit_id\"",
    );
    expect(providerLeaseCleanupSource).toContain('lease.provider !== "vault"');
    expect(managedAccessTargetRouteSource).toContain(
      'action: "provider.provisioning.destroy_deferred"',
    );
    expect(workspaceRevocationGatesSource).toContain("workspaceProviderResource.capabilityManifest");
    expect(desktopSharedConnectionSource).not.toContain("SHARED_CONNECTION_WRITE_BLOCKED");
    // The contract is the authorization call and its scope, not the checkout's
    // line endings, which arrive as CRLF on a Windows working tree.
    expect(managedAccessTargetRouteSource.replace(/\r\n/g, "\n")).toContain(
      'authorizeWorkspaceConnection(\n    request,\n    workspaceId,\n    connectionId,\n    "manage",',
    );
    expect(managedAccessTargetRouteSource).toContain("loadProviderProvisioningTarget");
    expect(managedAccessTargetRouteSource).toContain("validateGcpCloudSqlResource");
    expect(managedAccessTargetRouteSource).toContain('ownershipMarker("gcpCloudSql", connectionId)');
    expect(managedAccessTargetRouteSource).toContain("validateNeonResource");
    expect(managedAccessTargetRouteSource).toContain('ownershipMarker("neon", connectionId)');
    expect(providerProvisioningTargetSource).toContain(
      "workspaceProviderImportRequest.connectionId, workspaceConnection.id",
    );
    expect(providerProvisioningTargetSource).toContain(
      "workspaceConnection.providerResource} = ${workspaceProviderResource.resource}",
    );
    expect(providerProvisioningTargetSource).toContain(
      "createHash(\"sha256\").update(row.externalAccountId).digest(\"hex\")",
    );
    expect(providerProvisioningTargetSource).toContain("AUTHORITY_TTL_MS = 5 * 60 * 1_000");

    expect(providerAdapterContractSource).toContain("write: boolean");
    expect(providerResourcesRouteSource).toContain('integration.provider === "planetScale"');
    expect(providerResourcesRouteSource).not.toContain(
      'integration.provider === "planetScale" || integration.provider === "neon"',
    );
    expect(neonCoreSource).toContain("ALTER DEFAULT PRIVILEGES FOR ROLE");
    expect(neonCoreSource).toContain("NEON_CREDENTIAL_SCHEMA_VERSION = 2");
    expect(neonCoreSource).toContain("parseNeonCredential");
    expect(neonCoreSource).toContain("row.schemaVersion !== 1");
    expect(neonCoreSource).toContain("projectId: current ? row.projectId");
    expect(neonCoreSource).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES");
    expect(neonCoreSource).toContain("REVOKE ALL PRIVILEGES ON TABLES");
    expect(neonCoreSource).toContain("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA");
    expect(neonCoreSource).toContain("NEON_SCHEMA_LEASE_SECONDS = 5 * 60");
    expect(neonManagedAccessSource).toContain(
      "Neon managed schema access requires PostgreSQL 16 or newer",
    );
    expect(workspaceRevocationGatesSource).toContain("schema_busy");
    expect(providerLeaseCleanupSource).toContain('["write", "schema"]');
    expect(neonCoreSource).toContain("REASSIGN OWNED BY");
    expect(neonCoreSource).toContain("WITH INHERIT FALSE, SET TRUE, ADMIN FALSE");
    expect(neonSource).toContain("FROM pg_default_acl d");
    expect(neonSource).toContain("Neon future-object privilege verification failed");
    expect(neonSource).toContain('apiRequest(credential, "/auth")');
    expect(neonSource).toContain("`/projects/${apiSegment(credential.projectId)}`");
    expect(neonSource).toContain("credential.projectId === null");
    expect(neonSource).toContain("seenCursors.has(next)");
    expect(neonSource).toContain("MAX_NEON_RESPONSE_BYTES");
    expect(neonSource).toContain("boundedJsonResponse(response, maxBytes)");
    expect(neonSource).not.toContain("response.json()");
    expect(boundedJsonResponseSource).toContain("response.body.getReader()");
    expect(boundedJsonResponseSource).toContain('new TextDecoder("utf-8", { fatal: true })');
    expect(neonSource).toContain("listNeonBranchInventory");
    expect(neonBranchesSource).toContain(
      'treeParentId: branchInitSource === "schema-only" ? null : parentId',
    );
    expect(neonBranchesSource).toContain("Neon branch hierarchy contains a cycle");
    expect(neonBranchesRouteSource).toContain("verifiedNeonProjectCredential");
    expect(neonBranchesRouteSource).toContain("revalidateProviderDiscoveryAuthority");
    expect(neonBranchesRouteSource).toContain("missingTargets");
    expect(neonBranchesRouteSource).toContain("export const maxDuration = 60");
    expect(neonBranchesRouteSource).not.toContain("export async function POST");
    expect(neonBranchOperationsRouteSource).toContain("boundedJsonBody");
    expect(neonBranchOperationsRouteSource).toContain("export async function GET");
    expect(neonBranchOperationsRouteSource).toContain("listNeonBranchOperations");
    expect(neonBranchOperationsRouteSource).toContain("runNeonBranchOperation");
    expect(neonBranchOperationsRouteSource).toContain("authorizeWorkspaceConnection");
    expect(neonBranchOperationsRouteSource).not.toContain("drizzle-orm");
    expect(neonBranchOperationsRouteSource).not.toContain("provider-operation-store");
    expect(neonBranchOperationsRouteSource).not.toContain("recordProviderOperationPlan");
    expect(neonBranchOperationCommandSource).toContain("Object.keys(body).length === 4");
    expect(neonBranchOperationCommandSource).toContain("/^[0-9a-f]{64}$/");
    expect(parseNeonBranchOperationCommand({
      action: "executeCreate",
      operationId: "00000000-0000-4000-8000-000000000001",
      planHash: "a".repeat(64),
    })).toEqual({
      action: "executeCreate",
      operationId: "00000000-0000-4000-8000-000000000001",
      planHash: "a".repeat(64),
    });
    expect(parseNeonBranchOperationCommand({
      action: "executeCreate",
      operationId: "00000000-0000-4000-8000-000000000001",
      planHash: "a".repeat(64),
      ignored: true,
    })).toBeNull();
    expect(neonBranchOperationsApplicationSource).toContain("listProviderOperationExecutions");
    expect(neonBranchOperationsApplicationSource).toContain("requestedByCurrentActor");
    expect(neonBranchOperationsApplicationSource).toContain("canApprove");
    expect(neonBranchOperationsApplicationSource).toContain("recordProviderOperationPlan");
    expect(neonBranchOperationsApplicationSource).toContain("revalidateNeonBranchCreatePlan");
    expect(neonBranchOperationsApplicationSource).toContain("decideProviderOperation");
    expect(neonBranchOperationsApplicationSource).toContain("claimProviderOperationExecution");
    expect(neonBranchOperationsApplicationSource).toContain("cancelExpiredProviderOperationExecution");
    expect(neonBranchOperationsApplicationSource).toContain("markProviderOperationRemoteStarted");
    expect(neonBranchOperationsApplicationSource).toContain("reconcileNeonBranchCreate");
    expect(neonBranchOperationsApplicationSource).toContain("revalidateNeonBranchDeletePlan");
    expect(neonBranchOperationsApplicationSource).toContain("verifyNeonBranchOwnership");
    expect(neonBranchOperationsApplicationSource).toContain("reconcileNeonBranchDelete");
    expect(neonBranchOperationsApplicationSource).toContain("revalidateNeonBranchSwitchPlan");
    expect(neonBranchOperationsApplicationSource).toContain("completeNeonBranchSwitch");
    expect(neonBranchOperationsApplicationSource).toContain("needsCredentialFenceRecovery");
    const switchExecutionStart = neonBranchOperationsApplicationSource.indexOf(
      'if (body.action === "executeSwitch") {',
    );
    const switchRemoteStart = neonBranchOperationsApplicationSource.indexOf(
      "const remoteStart = await markProviderOperationRemoteStarted",
      switchExecutionStart,
    );
    const switchLeaseRevocation = neonBranchOperationsApplicationSource.indexOf(
      "revocation = await revokeActiveLeases",
      switchExecutionStart,
    );
    const switchCommit = neonBranchOperationsApplicationSource.indexOf(
      "const completed = await completeNeonBranchSwitch",
      switchExecutionStart,
    );
    expect(switchExecutionStart).toBeGreaterThanOrEqual(0);
    expect(switchRemoteStart).toBeGreaterThan(switchExecutionStart);
    expect(switchLeaseRevocation).toBeGreaterThan(switchRemoteStart);
    expect(switchCommit).toBeGreaterThan(switchLeaseRevocation);
    const switchAmbiguousCommit = neonBranchOperationsApplicationSource.slice(
      switchCommit,
      neonBranchOperationsApplicationSource.indexOf("if (!completed)", switchCommit),
    );
    expect(switchAmbiguousCommit).toContain("releaseRevocationGateClaim(connectionClaim)");
    expect(switchAmbiguousCommit).not.toContain("clearRevocationGate(connectionClaim)");
    const deleteExecutionStart = neonBranchOperationsApplicationSource.indexOf(
      'if (body.action === "executeDelete") {',
    );
    const deleteRemoteStart = neonBranchOperationsApplicationSource.indexOf(
      "const remoteStart = await markProviderOperationRemoteStarted",
      deleteExecutionStart,
    );
    const deleteProviderCall = neonBranchOperationsApplicationSource.indexOf(
      "const receipt = await deleteNeonBranch",
      deleteExecutionStart,
    );
    expect(deleteExecutionStart).toBeGreaterThanOrEqual(0);
    expect(deleteRemoteStart).toBeGreaterThan(deleteExecutionStart);
    expect(deleteProviderCall).toBeGreaterThan(deleteRemoteStart);
    const createExecutionStart = neonBranchOperationsApplicationSource.indexOf(
      'if (body.action === "executeCreate") {',
      deleteProviderCall,
    );
    const createRemoteStart = neonBranchOperationsApplicationSource.indexOf(
      "const remoteStart = await markProviderOperationRemoteStarted",
      createExecutionStart,
    );
    const createProviderCall = neonBranchOperationsApplicationSource.indexOf(
      "const receipt = await createNeonBranch",
      createExecutionStart,
    );
    expect(createExecutionStart).toBeGreaterThan(deleteProviderCall);
    expect(createRemoteStart).toBeGreaterThan(createExecutionStart);
    expect(createProviderCall).toBeGreaterThan(createRemoteStart);
    expect(providerOperationStoreSource).toContain("providerMutationAuthoritySql");
    expect(providerOperationStoreSource).toContain("executionAuthorityLive");
    expect(providerOperationStoreSource).toContain("listProviderOperationExecutions");
    expect(providerOperationStoreSource).toContain(
      'PROVIDER_OPERATION_DURABLE_MUTATION_ENTRYPOINTS = Object.freeze([',
    );
    expect(providerOperationStoreSource).toContain('"recordProviderOperationPlan"');
    expect(providerOperationStoreSource).toContain('"decideProviderOperation"');
    expect(providerOperationStoreSource).toContain('"claimProviderOperationExecution"');
    expect(providerOperationStoreSource).toContain('"cancelExpiredProviderOperationExecution"');
    expect(providerOperationStoreSource).toContain('"markProviderOperationRemoteStarted"');
    expect(providerOperationStoreSource).toContain('"applyProviderOperationReconciliation"');
    expect(providerOperationStoreSource).toContain('"completeProviderOperationBootstrap"');
    expect(providerOperationStoreSource).toContain('"completeNeonBranchSwitch"');
    const remoteStartFence = providerOperationStoreSource.slice(
      providerOperationStoreSource.indexOf(
        "export async function markProviderOperationRemoteStarted",
      ),
      providerOperationStoreSource.indexOf(
        "type ProviderOperationReconciliationRow",
      ),
    );
    expect(remoteStartFence).toContain("WITH authorized_operation AS MATERIALIZED");
    expect(remoteStartFence).toContain("), branch_lock AS MATERIALIZED (");
    expect(remoteStartFence).toContain("'provider-branch:'");
    expect(remoteStartFence).toContain("authorized_operation.\"resource_scope\"");
    expect(remoteStartFence).toContain("authorized_operation.\"source_resource_id\"");
    expect(remoteStartFence).toContain("workspaceCredentialLease");
    expect(remoteStartFence).toContain("active_lease.\"expires_at\" > now()");
    expect(remoteStartFence.indexOf("WITH authorized_operation")).toBeLessThan(
      remoteStartFence.indexOf("), branch_lock AS MATERIALIZED ("),
    );
    expect(remoteStartFence.indexOf("), branch_lock AS MATERIALIZED (")).toBeLessThan(
      remoteStartFence.indexOf("), candidate AS MATERIALIZED ("),
    );
    expect(providerOperationStoreSource).toContain(
      'key === "credentialFenceFingerprint"',
    );
    expect(providerOperationStoreSource).toContain(
      'operation."redacted_result"->>\'managedAccessState\'',
    );
    expect(providerOperationStoreSource).toContain(
      "IN ('bootstrap_required', 'ready')",
    );
    const bootstrapCompletionStart = providerOperationStoreSource.indexOf(
      "export async function completeProviderOperationBootstrap",
    );
    const bootstrapAuditStart = providerOperationStoreSource.indexOf(
      "), audited AS (",
      bootstrapCompletionStart,
    );
    const bootstrapUpdateStart = providerOperationStoreSource.indexOf(
      "), updated AS MATERIALIZED (",
      bootstrapCompletionStart,
    );
    expect(bootstrapCompletionStart).toBeGreaterThanOrEqual(0);
    expect(bootstrapAuditStart).toBeGreaterThan(bootstrapCompletionStart);
    expect(bootstrapUpdateStart).toBeGreaterThan(bootstrapAuditStart);
    expect(neonBootstrapRouteSource).toContain("completeProviderOperationBootstrap");
    expect(neonBootstrapRouteSource).toContain("neonBranchDatabaseFingerprint");
    expect(providerResourcesRouteSource).toContain(
      "requireNeonBranchManagedAccessReady",
    );
    expect(providerLeaseIssuanceSource).toContain(
      "requireNeonBranchManagedAccessReady",
    );
    expect(providerOperationStoreSource).toContain("requester_session");
    expect(providerOperationStoreSource).toContain(
      'operation."approval_policy" <> \'separate_admin\'',
    );
    expect(providerOperationStoreSource).toContain(
      'operation."plan_expires_at" > now()',
    );
    expect(providerOperationStoreSource).toContain(
      'ON CONFLICT ("organization_id", "idempotency_key") DO UPDATE',
    );
    expect(providerOperationStoreSource).toContain("JOIN audit");
    expect(providerOperationStoreSource).toContain("canonicalHash(input.plan)");
    expect(providerOperationMarkerSource).toContain("hkdfSync");
    expect(providerOperationMarkerSource).toContain("timingSafeEqual");
    expect(neonSource).toContain('"x-request-id": input.plan.operationId');
    expect(neonSource).toContain("response.status === 423 || response.status === 503");
    expect(neonSource).toContain("reconcileNeonBranchCreate");
    expect(neonSource).toContain("reconcileNeonBranchDelete");
    expect(neonSource).not.toContain("hard_delete");
    expect(neonSource).toContain('row.branch_id !== branch');
    expect(neonSource).toContain('requiredResourceId(row.id, "database id") === resource.databaseId');
    expect(neonSource).toContain("endpoints.length !== 1");
    expect(neonSource).toContain("pg_terminate_backend(pid)");
    expect(neonSource).toContain("NEON_INHERITED_CREDENTIAL_FENCE_FAILED");
    expect(neonSource).toContain('"bootstrap_required"');
    expect(neonBranchOperationsApplicationSource).toContain("databaseFingerprint");
    expect(providerOperationStoreSource).toContain("managedAccessState");
    expect(providerOperationStoreSource).toContain("credentialFenceFingerprint");
    expect(providerOperationStoreSource).toContain("provider-operation:complete-fenced");
    const switchCompletionStart = providerOperationStoreSource.indexOf(
      "export async function completeNeonBranchSwitch",
    );
    expect(switchCompletionStart).toBeGreaterThanOrEqual(0);
    const switchCompletion = providerOperationStoreSource.slice(switchCompletionStart);
    expect(switchCompletion).toContain("workspaceCredentialLease");
    expect(switchCompletion).toContain('live_lease."revoked_at" IS NULL');
    expect(switchCompletion).toContain('"content_revision" = connection."content_revision" + 1');
    expect(switchCompletion).toContain('"provider_resource_id" = target_scope."id"');
    expect(switchCompletion).toContain("connection.provider_target.switch");
    expect(providerOperationMigrationSource).toContain(
      '"approval_policy" text NOT NULL',
    );
    expect(providerOperationMigrationSource).toContain("'remote_started'");
    expect(providerOperationMigrationSource).toContain("'separate_admin'");
    expect(providerOperationMigrationSource).toContain(
      'FOREIGN KEY ("organization_id","integration_id","provider")',
    );
    expect(providerOperationKindMigrationSource).toContain(
      "'neon.branch.create', 'neon.branch.delete'",
    );
    expect(providerOperationSwitchMigrationSource).toContain("'neon.branch.switch'");
    expect(providerIntegrationRouteSource).toContain('"api-key-v1"');
    expect(neonSource).toContain(
      "providerAuditId: `${branch.value}:${database.id}`",
    );
    expect(neonSource).toContain("endpointId: connection.endpoint.id");
    expect(neonSource).toContain("item.id === resource.databaseId");
    expect(neonCoreSource).toContain("databaseId: string");
    expect(neonBootstrapSource).toContain("NEON_REVOKE_PUBLIC_DATABASE_");
    expect(neonBootstrapSource).toContain("NEON_REVOKE_OTHER_DATABASE_PUBLIC_CONNECT");
    expect(neonBootstrapSource).toContain("NEON_PUBLIC_SECURITY_DEFINER");
    expect(neonBootstrapSource).toContain("NEON_LEASE_ROLE_DRIFT");
    expect(neonBootstrapSource).toContain("NEON_ACTIVE_LEASE_ROLE_PRESENT");
    expect(neonBootstrapSource).toContain("NEON_OWNERSHIP_MARKER_MEMBERSHIP_DRIFT");
    expect(neonBootstrapSource).toContain("policy_owner.rolname = $2");
    expect(neonBootstrapSource).toContain("server_version_num");
    expect(neonBootstrapSource).toContain("NEON_READ_WRITE_SMOKE_PLANNED");
    expect(neonBootstrapSource).toContain("expectedPlanHash");
    expect(neonBootstrapSource).toContain("expectedReadyHash");
    expect(neonBootstrapSource).toContain('state: "preflight"');
    expect(neonBootstrapSource).toContain("publicAclApproved");
    expect(neonBootstrapSource).toContain("productionApproved");
    expect(neonBootstrapSource).toContain("negative write smoke failed");
    expect(neonBootstrapSource).toContain("positive write smoke failed");
    expect(neonBootstrapSource).toContain("negative DDL smoke failed");
    expect(neonBootstrapSource).toContain("negative role management smoke failed");
    expect(neonBootstrapSource).toContain("DROP TABLE ${qualifiedTable}");
    expect(neonBootstrapSource).toContain("rolled back");
    expect(neonBootstrapSource).toContain("NeonBootstrapRepairRequiredError");
    expect(neonBootstrapRouteSource).toContain("openProviderDiscoveryProof");
    expect(neonBootstrapRouteSource).toContain("sealNeonBootstrapPlan");
    expect(neonBootstrapRouteSource).toContain("openNeonBootstrapPlan");
    expect(neonBootstrapRouteSource).toContain("recordProviderDiscoveryReceipt");
    expect(neonBootstrapRouteSource).toContain("writeAvailable: true");
    expect(neonBootstrapRouteSource).toContain("temporaryObject");
    expect(neonBootstrapRouteSource).toContain("provider.neon.bootstrap_needs_repair");
    expect(neonBootstrapRouteSource).toContain("recordBootstrapAudit");
    expect(neonBootstrapRouteSource).toContain(
      'authorization.role !== "admin" && authorization.role !== "owner"',
    );
    expect(providerResourcesRouteSource).toContain("canBootstrapNeon");
    expect(providerImportProjectionSource).toContain(
      '(provider !== "neon" && item.production === false)',
    );
    expect(providerAccessDomainSource).toContain("parseNeonBootstrapPreflight");
    expect(providerAccessDomainSource).toContain("parseNeonBootstrapApply");
    expect(neonProviderBootstrapControllerSource).toContain('action: "preflight"');
    expect(neonProviderBootstrapControllerSource).toContain('action: "apply"');
    expect(neonProviderBootstrapControllerSource).toContain("pendingApplyRef");
    expect(providerResourcePickerSource).toContain("copy.neonTitle");
    expect(providerResourcePickerSource).toContain("copy.publicApproval");
    expect(workspaceMessagesSource).toContain("Prepare Neon least-privilege access");
    expect(workspaceMessagesSource).toContain("Neon 최소권한 준비");
    expect(workspaceMessagesSource).toContain("표시된 PUBLIC 권한 회수를 승인합니다");
    expect(providerResourcePickerSource).not.toMatch(/setup terminal|SQL 입력/);
    expect(neonBranchManagerSource).toContain("copy.createNoChangePlan");
    expect(neonBranchManagerSource).toContain("copy.productionCopyNotice");
    expect(neonBranchManagerSource).toContain("copy.createDeletePlan");
    expect(neonBranchManagerSource).toContain("copy.createSwitchPlan");
    expect(neonBranchManagerSource).toContain("copy.switchDescription");
    expect(neonBranchManagerSource).toContain("copy.safeRun.currentTitle");
    expect(neonBranchManagerSource).toContain("copy.safeRun.returnPlan");
    expect(workspaceMessagesSource).toContain("Create no-change plan");
    expect(workspaceMessagesSource).toContain("변경 없는 계획 만들기");
    expect(sharedDatabaseControllerSource).toContain('method: "DELETE"');
    expect(sharedDatabaseControllerSource).toContain('"x-dopedb-expected-revision"');
    expect(sharedDatabasePanelSource).toContain("copy.remove");
    expect(sharedDatabasePanelSource).toContain("copy.desktopRecovery");
    expect(sharedDatabasePanelSource).toContain('id={`database-${connection.id}`}');
    expect(sharedDatabasePanelSource).toContain("copy.manageProvider");
    expect(connectionAccessPanelSource).toContain("copy.writePolicyStatus");
    expect(connectionAccessPanelSource).toContain("copy.writePolicyDesktop");
    expect(connectionAccessPanelSource).not.toContain("changeWritePolicy");
    expect(connectionAccessPanelSource).not.toContain('type="checkbox"');
    expect(safetySettingsScreenSource).toContain("hasUnsavedChanges");
    expect(safetySettingsScreenSource).toContain('variant="primary"');
    expect(safetySettingsScreenSource).toContain('t("safety.unsavedChanges")');
    expect(workspaceMessagesSource).toContain("Remove shared database");
    expect(workspaceMessagesSource).toContain("공유 DB 제거");
    expect(neonBranchManagerSource).not.toMatch(/>Switch<|>Restore<|>Delete</);
    const branchPlan = {
      version: 1,
      kind: "neon.branch.create",
      operationId: "77777777-7777-4777-8777-777777777777",
      integrationId,
      integrationGeneration: "12",
      issuedAt: "2026-08-05T03:00:00.000Z",
      expiresAt: "2026-08-05T03:10:00.000Z",
      source: {
        projectId: "quiet-sun-12345678",
        branchId: "br-main-12345678",
        name: "main",
        protected: true,
        default: true,
        environment: "production",
        point: { kind: "head" },
      },
      target: {
        name: "agent-safe-copy",
        initSource: "parent-data",
        endpoint: "read_write",
        copiesData: true,
        createsCompute: true,
      },
      risk: "production_data",
      approvalPolicy: "separate_admin",
      warningCodes: ["NEON_PRODUCTION_DATA_COPY"],
    };
    const branchOperations = parseNeonBranchOperations({
      integrationGeneration: "12",
      operations: [{
        id: branchPlan.operationId,
        state: "awaiting_approval",
        planHash: "a".repeat(64),
        planExpiresAt: branchPlan.expiresAt,
        expired: false,
        risk: "production_data",
        approvalPolicy: "separate_admin",
        requestedByCurrentActor: true,
        canApprove: false,
        canReject: true,
        canExecute: false,
        needsCredentialFenceRecovery: false,
        providerOperationId: null,
        branchId: null,
        reconcileAfter: null,
        endpointId: null,
        databaseCount: null,
        retiredInheritedRoleCount: null,
        managedAccessState: null,
        failureCode: null,
        plan: branchPlan,
      }],
    });
    expect(branchOperations?.operations[0]).toEqual(expect.objectContaining({
      requestedByCurrentActor: true,
      canApprove: false,
      approvalPolicy: "separate_admin",
    }));
    expect(parseNeonBranchOperations({
      integrationGeneration: "12",
      operations: [{ ...branchOperations?.operations[0], token: "must-not-pass" }],
    })).toBeNull();

    const safeBranchId = "br-agent-safe";
    const safeConnection = {
      connectionId,
      connectionName: "Shared development",
      database: "app",
      environment: "development",
      allowWrites: true,
      contentRevision: 8,
      authorityRevision: 12,
      activeLeaseCount: 0,
    };
    const uiBranch = (input: {
      id: string;
      name: string;
      parentId: string | null;
      depth: number;
      connections: unknown[];
      managed?: boolean;
      deletable?: boolean;
    }) => ({
      id: input.id,
      projectId: branchPlan.source.projectId,
      parentId: input.parentId,
      treeParentId: input.parentId,
      name: input.name,
      currentState: "ready",
      pendingState: null,
      stateChangedAt: "2026-08-05T03:01:00.000Z",
      createdAt: "2026-08-05T03:01:00.000Z",
      updatedAt: "2026-08-05T03:01:00.000Z",
      creationSource: "api",
      initSource: "parent-data",
      sourceLsn: null,
      sourceTimestamp: null,
      default: input.parentId === null,
      protected: input.parentId === null,
      expiresAt: null,
      restrictedActions: [],
      production: input.parentId === null,
      ready: true,
      depth: input.depth,
      connections: input.connections,
      ...(input.managed ? {
        managedAccess: {
          operationId: branchPlan.operationId,
          state: "succeeded",
          status: "ready",
        },
      } : {}),
      ...(input.deletable === undefined ? {} : {
        deletion: input.deletable
          ? { canPlan: true, blockerCodes: [] }
          : { canPlan: false, blockerCodes: ["WORKSPACE_CONNECTIONS"] },
      }),
    });
    const safeInventory = (sourceConnections: unknown[], targetConnections: unknown[]) => (
      parseNeonBranchInventoryResponse({
        projectId: branchPlan.source.projectId,
        integrationGeneration: "12",
        observedAt: "2026-08-05T03:07:00.000Z",
        rootIds: [branchPlan.source.branchId],
        missingTargets: [],
        branches: [
          uiBranch({
            id: branchPlan.source.branchId,
            name: branchPlan.source.name,
            parentId: null,
            depth: 0,
            connections: sourceConnections,
          }),
          uiBranch({
            id: safeBranchId,
            name: branchPlan.target.name,
            parentId: branchPlan.source.branchId,
            depth: 1,
            connections: targetConnections,
            managed: true,
            deletable: targetConnections.length === 0,
          }),
        ],
      })
    );
    const succeededCreate = {
      ...(branchOperations?.operations[0] as NonNullable<typeof branchOperations>["operations"][number]),
      state: "succeeded",
      requestedByCurrentActor: true,
      canApprove: false,
      canReject: false,
      canExecute: false,
      providerOperationId: "21212121-2121-4121-8121-212121212121",
      branchId: safeBranchId,
      endpointId: "ep-agent-safe",
      databaseCount: 1,
      retiredInheritedRoleCount: 0,
      managedAccessState: "ready",
    } as const;
    const isolatePlan = {
      version: 1,
      kind: "neon.branch.switch",
      operationId: "18181818-1818-4818-8818-181818181818",
      integrationId,
      integrationGeneration: "12",
      issuedAt: "2026-08-05T03:02:00.000Z",
      expiresAt: "2026-08-05T03:12:00.000Z",
      source: {
        projectId: branchPlan.source.projectId,
        branchId: branchPlan.source.branchId,
        name: branchPlan.source.name,
        connectionId,
        connectionName: safeConnection.connectionName,
        database: safeConnection.database,
        environment: "production",
        activeLeaseCount: 0,
      },
      target: {
        projectId: branchPlan.source.projectId,
        branchId: safeBranchId,
        name: branchPlan.target.name,
        database: safeConnection.database,
        environment: "production",
      },
      impact: {
        activeLeaseCount: 0,
        closesExistingSessions: true,
        createsConnectionRevision: true,
        reintrospectionRequired: true,
      },
      risk: "production_data",
      approvalPolicy: "separate_admin",
      warningCodes: ["NEON_CONNECTION_TARGET_CHANGES"],
    } as const;
    const returnPlan = {
      ...isolatePlan,
      operationId: "19191919-1919-4919-8919-191919191919",
      issuedAt: "2026-08-05T03:05:00.000Z",
      expiresAt: "2026-08-05T03:15:00.000Z",
      source: {
        ...isolatePlan.source,
        branchId: safeBranchId,
        name: branchPlan.target.name,
      },
      target: {
        ...isolatePlan.target,
        branchId: branchPlan.source.branchId,
        name: branchPlan.source.name,
      },
    } as const;
    const deletePlanForJourney = {
      version: 1,
      kind: "neon.branch.delete",
      operationId: "20202020-2020-4020-8020-202020202020",
      integrationId,
      integrationGeneration: "12",
      issuedAt: "2026-08-05T03:06:00.000Z",
      expiresAt: "2026-08-05T03:16:00.000Z",
      target: {
        projectId: branchPlan.source.projectId,
        branchId: safeBranchId,
        name: branchPlan.target.name,
        default: false,
        protected: false,
        expiresAt: null,
      },
      references: {
        connectionCount: 0,
        activeLeaseCount: 0,
        endpointIds: ["ep-agent-safe"],
      },
      ownership: {
        createOperationId: branchPlan.operationId,
        createPlanHash: "a".repeat(64),
      },
      deletionMode: "provider_default_soft_delete",
      risk: "standard",
      approvalPolicy: "single_admin",
      warningCodes: ["NEON_SOFT_DELETE_RECOVERY_NOT_GUARANTEED"],
    } as const;
    const succeededOperation = (plan: typeof isolatePlan | typeof returnPlan | typeof deletePlanForJourney) => ({
      id: plan.operationId,
      state: "succeeded",
      planHash: "b".repeat(64),
      planExpiresAt: plan.expiresAt,
      expired: false,
      risk: plan.risk,
      approvalPolicy: plan.approvalPolicy,
      requestedByCurrentActor: true,
      canApprove: false,
      canReject: false,
      canExecute: false,
      needsCredentialFenceRecovery: false,
      providerOperationId: null,
      branchId: plan.kind === "neon.branch.switch"
        ? plan.target.branchId
        : plan.target.branchId,
      reconcileAfter: null,
      endpointId: null,
      databaseCount: null,
      retiredInheritedRoleCount: null,
      managedAccessState: null,
      failureCode: null,
      plan,
    });
    const parsedJourneyOperations = parseNeonBranchOperations({
      integrationGeneration: "12",
      operations: [
        succeededOperation(deletePlanForJourney),
        succeededOperation(returnPlan),
        succeededOperation(isolatePlan),
        succeededCreate,
      ],
    });
    expect(parsedJourneyOperations).not.toBeNull();
    const readyInventory = safeInventory([safeConnection], []);
    expect(readyInventory).not.toBeNull();
    expect(deriveNeonSafeRun(
      readyInventory!,
      [succeededCreate] as NonNullable<typeof parsedJourneyOperations>["operations"],
    )?.phase).toBe("ready_to_isolate");
    const isolatedInventory = safeInventory([], [safeConnection]);
    expect(isolatedInventory).not.toBeNull();
    expect(deriveNeonSafeRun(
      isolatedInventory!,
      parsedJourneyOperations!.operations.filter((operation) => (
        operation.plan.kind !== "neon.branch.delete"
        && operation.id !== returnPlan.operationId
      )),
    )).toMatchObject({
      phase: "isolated_active",
      switchedConnectionId: connectionId,
      switchedFromSource: true,
    });
    expect(deriveNeonSafeRun(
      readyInventory!,
      parsedJourneyOperations!.operations.filter((operation) => (
        operation.plan.kind !== "neon.branch.delete"
      )),
    )?.phase).toBe("ready_to_discard");
    const discardedInventory = parseNeonBranchInventoryResponse({
      projectId: branchPlan.source.projectId,
      integrationGeneration: "12",
      observedAt: "2026-08-05T03:07:00.000Z",
      rootIds: [branchPlan.source.branchId],
      missingTargets: [],
      branches: [uiBranch({
        id: branchPlan.source.branchId,
        name: branchPlan.source.name,
        parentId: null,
        depth: 0,
        connections: [safeConnection],
      })],
    });
    expect(discardedInventory).not.toBeNull();
    expect(deriveNeonSafeRun(
      discardedInventory!,
      parsedJourneyOperations!.operations,
    )?.phase).toBe("discarded");
    expect(parseNeonBranchOperations({
      integrationGeneration: "12",
      operations: [{
        id: switchPlan.operationId,
        state: "approved",
        planHash: "b".repeat(64),
        planExpiresAt: switchPlan.expiresAt,
        expired: false,
        risk: switchPlan.risk,
        approvalPolicy: switchPlan.approvalPolicy,
        requestedByCurrentActor: true,
        canApprove: false,
        canReject: false,
        canExecute: true,
        needsCredentialFenceRecovery: false,
        providerOperationId: null,
        branchId: null,
        reconcileAfter: null,
        endpointId: null,
        databaseCount: null,
        retiredInheritedRoleCount: null,
        managedAccessState: null,
        failureCode: null,
        plan: switchPlan,
      }],
    })?.operations[0]?.plan).toMatchObject({
      kind: "neon.branch.switch",
      source: { connectionId, branchId: "br-child" },
      target: { branchId: "br-target" },
    });
    expect(parseNeonBranchOperations({
      integrationGeneration: "12",
      operations: [{
        id: switchPlan.operationId,
        state: "approved",
        planHash: "b".repeat(64),
        planExpiresAt: switchPlan.expiresAt,
        expired: false,
        risk: switchPlan.risk,
        approvalPolicy: switchPlan.approvalPolicy,
        requestedByCurrentActor: true,
        canApprove: false,
        canReject: false,
        canExecute: true,
        needsCredentialFenceRecovery: false,
        providerOperationId: null,
        branchId: null,
        reconcileAfter: null,
        endpointId: null,
        databaseCount: null,
        retiredInheritedRoleCount: null,
        managedAccessState: null,
        failureCode: null,
        plan: {
          ...switchPlan,
          target: { ...switchPlan.target, projectId: "forged-project" },
        },
      }],
    })).toBeNull();
    expect(neonSource).toContain("NeonLeaseCleanupRequiredError");
    expect(providerLeaseIssuanceSource).toContain(
      "error instanceof NeonLeaseCleanupRequiredError",
    );
    expect(managedAccessTargetRouteSource).toContain("inspectNeonResourceIdentity");
    expect(providerImportProjectionSource).toContain(
      'item.kind === "mysql" && item.safeMigrations === true',
    );
    expect(providerImportProjectionSource).toContain(
      "capabilities: { ...projected.capabilities, write: true }",
    );
    expect(workspaceConnectionsSource).toContain(
      'credentialMode === "member_local" && allowWrites',
    );
    expect(workspaceConnectionsSource).toContain("allowWrites: effectiveWrite");
    expect(providerIntegrationSource).toContain("providerTarget: {");
    expect(providerDiscoveryProofSource).toContain('"providerTarget"');
    expect(neonBootstrapRouteSource).toContain("neonBranchTarget: plan.providerTarget");
    expect(workspaceConnectionsSource).toContain("providerTarget: publicProviderTarget(row)");
    expect(desktopControlPlaneSource).toContain("provider_target: Option<ConnectionProviderTarget>");
    expect(desktopSharedConnectionSource).toContain("valid_provider_target");
    expect(workspacePermissionsSource).toContain(
      'hasWorkspaceCapability(role, "write")',
    );
    expect(workspacePermissionsSource).toContain('return "write" as const');
    expect(workspaceVersioningStoreSource).toContain(
      '"connection.write_policy.update"',
    );
    expect(workspaceVersioningStoreSource).toContain(
      `member."role" IN ('admin', 'owner')`,
    );
    const rawConnectionGrantSql = [
      connectionGrantsRouteSource,
      managedAccessRouteSource,
      providerImportStoreSource,
      providerLocalTargetSource,
      workspaceVersioningStoreSource,
    ];
    for (const source of rawConnectionGrantSql) {
      expect(source).not.toMatch(
        /(?:workspace_connection_grant"|workspaceConnectionGrant\})\s+(?:AS\s+)?grant\b/,
      );
      expect(source).not.toMatch(/FOR UPDATE OF[^\n]*\bgrant\b/);
    }
    const providerImportAuditSql = providerImportStoreSource.slice(
      providerImportStoreSource.indexOf("), audit AS MATERIALIZED ("),
      providerImportStoreSource.indexOf("), recorded AS MATERIALIZED ("),
    );
    expect(providerImportAuditSql).toContain("JOIN fresh ON TRUE");
    expect(providerImportStoreSource.match(
      /'productionApproved', \$\{input\.productionApproved\}::boolean/g,
    )).toHaveLength(2);
    expect(providerImportStoreSource).toContain("), branch_lock AS MATERIALIZED (");
    expect(providerImportStoreSource).toContain("'provider-branch:'");
    expect(providerImportStoreSource).toContain('AS "deletionBlocked"');
    expect(providerImportStoreSource).toContain(
      'mutation."kind" = \'neon.branch.delete\'',
    );
    expect(providerImportStoreSource).toContain(
      'mutation."kind" = \'neon.branch.switch\'',
    );
    expect(providerImportStoreSource).toContain(
      "'approved', 'claimed', 'remote_started', 'reconciling', 'succeeded'",
    );
    expect(providerImportAuditSql).toContain(
      "'preservedConnectionId', ${replacing}::boolean",
    );

    const legacyBackup = JSON.parse(legacyProviderBackupSource);
    expect(legacyBackup.connections).toEqual([
      expect.objectContaining({
        provider: "gcpCloudSql",
        readonlyDefault: false,
        allowWrites: true,
      }),
    ]);
    expect(workspaceBackupCoreSource).toContain("parseBackupConnection(template)");
    expect(workspaceBackupCoreSource).toContain("...parseBackupConnection(template)");
    expect(workspaceKmsSource).toContain('request.headers.get("x-vercel-oidc-token")');
    expect(workspaceKmsSource).toContain("https://sts.googleapis.com/v1/token");
    expect(workspaceKmsSource).toContain(":generateAccessToken");
    expect(workspaceKmsSource).not.toMatch(
      /GOOGLE_APPLICATION_CREDENTIALS|private_key|client_email|serviceAccountKey/i,
    );
    expect(workspaceDataKeySource).toContain("plaintextKey.fill(0)");
    expect(workspaceDataKeySource).toContain("workspace-data-key:");
    expect(workspaceBackupSource).toContain("openWorkspaceMetadataBackupWithKms");
    expect(workspaceDataKeyRotationSource).toContain("member.\"role\" = 'owner'");
    expect(workspaceDataKeyRotationSource).toContain('"wrapped_key" = NULL');
    expect(workspaceDataKeyMigrationSource).toContain(
      'CREATE TABLE "workspace_control"."workspace_data_key"',
    );
    expect(workspaceDataKeyMigrationSource).toContain(
      'WHERE "retired_at" IS NULL',
    );
    expect(workspaceBackupRotationMigrationSource).toContain(
      "immutable outside an active key rotation",
    );
    expect(workspaceLifecycleMigrationSource).toContain(
      'CREATE TABLE "workspace_control"."workspace_deletion_receipt"',
    );
    expect(workspaceLifecycleMigrationSource).toContain(
      'CREATE OR REPLACE FUNCTION "workspace_control"."purge_due_workspace"',
    );
    expect(workspaceLifecycleMigrationSource).toContain(
      'REVOKE ALL ON FUNCTION "workspace_control"."purge_due_workspace"',
    );
    expect(workspaceLifecycleMigrationSource).toContain(
      "operation.state NOT IN ('succeeded', 'failed', 'cancelled')",
    );
    expect(workspaceLifecycleMigrationSource).toContain(
      "member.revocation_claim_id IS NOT NULL",
    );
    expect(workspaceLifecycleSource).toContain(
      'AND member."role" = \'owner\'',
    );
    expect(workspaceLifecycleSource).toContain(
      'AND organization."name" = ${input.confirmation}',
    );
    expect(workspaceLifecycleSource).toContain(
      'SET "lifecycle_state" = \'deletion_pending\'',
    );
    expect(workspaceLifecycleSource).toContain(
      'SET "active_organization_id" = NULL',
    );
    expect(workspaceAuthorizationSource).toContain(
      'authority.lifecycleState !== "active"',
    );
    expect(workspaceLifecycleRouteSource).toContain(
      'Object.keys(body).some((key) => !allowedKeys.includes(key))',
    );
    expect(workspaceLifecyclePanelSource).toContain(
      'confirmation !== lifecycle.workspaceName',
    );
    expect(workspaceSettingsNavigationSource).toContain(
      'item.id === "lifecycle" && !canDeleteWorkspace',
    );
    expect(workspaceVersioningStoreSource).toContain("readonlyDefault: true");
    expect(workspaceVersioningStoreSource).toContain("allowWrites: false");
    expect(JSON.stringify(legacyBackup)).not.toMatch(
      /password|secret|token|credential|serviceAccount/i,
    );

  });
});
