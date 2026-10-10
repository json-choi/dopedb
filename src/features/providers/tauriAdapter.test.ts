import { beforeEach, describe, expect, it, vi } from "vitest";

import adapterSource from "./tauriAdapter.ts?raw";
import authRouteSource from "../../../workspace-cloud/app/api/auth/[...all]/route.ts?raw";
import gcpBootstrapFacadeSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap.ts?raw";
import gcpBootstrapApplicationSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-application.ts?raw";
import gcpBootstrapCoreSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-core.ts?raw";
import gcpBootstrapDatabaseSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-database.ts?raw";
import gcpBootstrapIamSource from "../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-iam.ts?raw";
import gcpCloudSqlSource from "../../../workspace-cloud/lib/providers/gcp-cloud-sql.ts?raw";
import gcpCloudSqlCoreSource from "../../../workspace-cloud/lib/providers/gcp-cloud-sql-core.ts?raw";
import gcpCloudSqlHttpSource from "../../../workspace-cloud/lib/providers/gcp-cloud-managed-http.ts?raw";
import gcpSchemaAuthoritySource from "../../../workspace-cloud/lib/providers/gcp-cloud-schema-authority.ts?raw";
import gcpConnectionPolicySource from "../../../workspace-cloud/lib/providers/gcp-cloud-connection-policy.ts?raw";
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
import gcpOAuthCallbackSource from "../../../workspace-cloud/lib/providers/gcp-cloud-oauth-callback.ts?raw";
import managedLeaseRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/lease/route.ts?raw";
import managedAccessRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/managed-access/route.ts?raw";
import connectionActionRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/route.ts?raw";
import connectionGrantsRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/grants/route.ts?raw";
import providerIntegrationRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/route.ts?raw";
import providerIntegrationDomainSource from "../../../workspace-cloud/lib/provider-integrations/domain.ts?raw";
import providerIntegrationSource from "../../../workspace-cloud/lib/provider-integrations/integration.ts?raw";
import providerDiscoveryProofSource from "../../../workspace-cloud/lib/provider-discovery-proof.ts?raw";
import providerLeaseCleanupSource from "../../../workspace-cloud/lib/provider-integrations/lease-cleanup.ts?raw";
import providerLeaseIssuanceSource from "../../../workspace-cloud/lib/provider-integrations/lease-issuance.ts?raw";
import providerLeaseRevocationWindowSource from "../../../workspace-cloud/lib/provider-integrations/lease-revocation-window.ts?raw";
import workspaceAdminRoutesSource from "../../../src-tauri/src/features/workspace_admin/domain/routes.rs?raw";
import workspaceAdminAdapterSource from "../../../src-tauri/src/features/workspace_admin/adapters.rs?raw";
import publicAnalysisPageSource from "../../../workspace-cloud/app/analyses/[slug]/page.tsx?raw";
import publicAnalysisArticleSource from "../../../workspace-cloud/app/analyses/[slug]/PublicAnalysisArticle.tsx?raw";
import workspaceNotFoundSource from "../../../workspace-cloud/app/not-found.tsx?raw";
import workspaceErrorBoundarySource from "../../../workspace-cloud/app/error.tsx?raw";
import articleSharingCopySource from "../../../workspace-cloud/features/articleSharing/copy.ts?raw";
import providerCatalogSource from "../../../workspace-cloud/lib/provider-catalog.ts?raw";
import workspaceServerLogSource from "../../../workspace-cloud/lib/workspace-server-log.ts?raw";
import providerAdapterContractSource from "../../../workspace-cloud/lib/providers/adapter-contract.ts?raw";
import {
  issueAfterFreshProviderAuthority,
  MANAGED_PROVIDER_AUTHORITY_TIMEOUT_MS,
  verifiedProviderAuditId,
} from "../../../workspace-cloud/lib/providers/provider-types";
import providerImportProjectionSource from "../../../workspace-cloud/lib/providers/import-projection.ts?raw";
import providerImportStoreSource from "../../../workspace-cloud/lib/provider-import-store.ts?raw";
import providerImportRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/[integrationId]/imports/route.ts?raw";
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
import workspaceGuardSource from "../../../workspace-cloud/d1-migrations/0001_workspace_guards.sql?raw";
import workspaceMemberDetachmentSource from "../../../workspace-cloud/d1-migrations/0004_member_evidence_detachment.sql?raw";
import workspaceRetentionSource from "../../../workspace-cloud/d1-migrations/0006_retention_purge.sql?raw";
import workspaceBaselineSource from "../../../workspace-cloud/d1-migrations/0000_workspace_baseline.sql?raw";
import workspaceBackupCoreSource from "../../../workspace-cloud/lib/workspace-backup-core.ts?raw";
import workspaceBackupSource from "../../../workspace-cloud/lib/workspace-backup.ts?raw";
import workspaceDataKeySource from "../../../workspace-cloud/lib/workspace-data-key.ts?raw";
import workspaceDataKeyRotationSource from "../../../workspace-cloud/lib/workspace-data-key-rotation.ts?raw";
import workspaceKmsSource from "../../../workspace-cloud/lib/workspace-kms.ts?raw";
import workspaceLifecycleSource from "../../../workspace-cloud/lib/workspace-lifecycle.ts?raw";
import workspaceAuthorizationSource from "../../../workspace-cloud/lib/workspace-authorization.ts?raw";
import workspaceLifecycleRouteSource from "../../../workspace-cloud/app/api/v1/workspaces/[workspaceId]/lifecycle/route.ts?raw";
import workspaceConnectionsSource from "../../../workspace-cloud/lib/workspace-connections.ts?raw";
import workspacePermissionsSource from "../../../workspace-cloud/lib/workspace-permissions.ts?raw";
import workspaceRevocationGatesSource from "../../../workspace-cloud/lib/revocation-gates.ts?raw";
import workspaceSchemaSource from "../../../workspace-cloud/lib/d1/schema/leases.ts?raw";
import workspaceVersioningStoreSource from "../../../workspace-cloud/lib/workspace-versioning-store.ts?raw";
import workspaceSnapshotRestoreSource from "../../../workspace-cloud/lib/workspace-snapshot-restore.ts?raw";
import desktopSettingsSource from "../../../src/screens/Settings/index.tsx?raw";
import workspaceAdminDialogSource from "../../../src/screens/WorkspaceAdmin/index.tsx?raw";
import sectionDialogSource from "../../../src/design-system/components/SectionDialog.tsx?raw";
import safetySettingsScreenSource from "../../../src/screens/Settings/Safety/index.tsx?raw";
import desktopSharedConnectionSource from "../../../src-tauri/src/features/workspaces/adapters/control_plane/connections.rs?raw";
import desktopControlPlaneSource from "../../../src-tauri/src/features/workspaces/adapters/control_plane.rs?raw";
import hostedControlPlaneSource from "../../../src-tauri/src/hosted_control_plane.rs?raw";
import desktopRuntimePolicySource from "../../../src-tauri/src/connection/runtime_policy.rs?raw";
import desktopSchemaPolicySource from "../../../src-tauri/src/connection/gcp_schema_policy.rs?raw";
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
import { messages } from "../../lib/i18n/catalog";
import {
  accountId as workspaceAccountId,
  workspaceId as workspaceIdentity,
} from "../workspaces/domain";
import { sharedDatabasesQuery } from "../workspaceAdmin/access/queries";
import { parseMemberDirectory } from "../workspaceAdmin/members/domain";
import { workspaceAdminSectionsFor } from "../workspaceAdmin/sections";
import {
  connectableProvider,
  hasBroadNeonKey,
  managedDatabaseCount,
  providerAccountGroups,
} from "../workspaceAdmin/providers/accounts/accountModel";
import {
  canRemoveSharedConnection,
  canRepairManagedAccess,
} from "../workspaceAdmin/providers/databases/model";
import {
  gcpActiveLeaseRetryMessage,
  parseGcpActiveLeaseConflict,
  parseNeonBootstrapApply,
  parseNeonBootstrapPreflight,
  type Integration,
  type Provider,
} from "../workspaceAdmin/providers/domain";
import {
  GcpBootstrapCancelled,
  GcpSetupExpired,
  prepareGcpSetupWithPropagationRetry,
} from "../workspaceAdmin/providers/gcp/gcpBootstrapTransport";
import {
  forgetGcpRepair,
  gcpApprovalsComplete,
  gcpPrepareOperation,
  gcpRepairTarget,
  pendingGcpRepair,
  rememberGcpRepair,
  type GcpApprovalInput,
} from "../workspaceAdmin/providers/gcp/gcpModel";
import { parseNeonBranchInventory as parseNeonBranchInventoryResponse } from "../workspaceAdmin/providers/neonBranches/branchInventory";
import { parseNeonBranchOperations } from "../workspaceAdmin/providers/neonBranches/branchOperations";
import { deriveNeonSafeRun } from "../workspaceAdmin/providers/neonBranches/safeRun";
import { WorkspaceAdminRequestError } from "../workspaceAdmin/requests";
import {
  gcpCloudSqlIntegrationIdentity,
  gcpCloudSqlPrincipalClaims,
  parseGcpCloudSqlCredential,
} from "../../../workspace-cloud/lib/providers/gcp-cloud-sql-core";
import {
  gcpConnectionDatabaseRoles,
  assertDatabaseUserRoles,
} from "../../../workspace-cloud/lib/providers/gcp-cloud-connection-policy";
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
// The real server setup error is loaded at run time below; its server-only marker
// has no behaviour of its own outside the Next.js build.
vi.mock("server-only", () => ({}));

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

// Desktop workspace administration owns the former Web console boundaries. Reading
// every module keeps a renamed or newly added file inside the same checks.
const workspaceAdminSources = import.meta.glob<string>(
  "../workspaceAdmin/**/*.{ts,tsx}",
  { query: "?raw", import: "default", eager: true },
);

function workspaceAdminSource(modulePath: string): string {
  const source = workspaceAdminSources[`../workspaceAdmin/${modulePath}`];
  if (source === undefined) {
    throw new Error(`Missing workspace administration module ${modulePath}`);
  }
  return source;
}

function workspaceAdminModulesUnder(directory: string): Array<[string, string]> {
  const modules = Object.entries(workspaceAdminSources)
    .filter(([modulePath]) => modulePath.startsWith(`../workspaceAdmin/${directory}`));
  if (modules.length === 0) {
    throw new Error(`Missing workspace administration directory ${directory}`);
  }
  return modules;
}

const adminAccountId = workspaceAccountId("account-admin");
const adminWorkspaceId = workspaceIdentity("12121212-1212-4212-8212-121212121212");

const gcpBootstrapSource = [
  gcpBootstrapFacadeSource,
  gcpBootstrapApplicationSource,
  gcpBootstrapCoreSource,
  gcpBootstrapDatabaseSource,
  gcpBootstrapIamSource,
  gcpConnectionPolicySource,
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

// One reviewed Cloud SQL setup target in Desktop Workspace management → Providers; each check
// overrides only the approval or instance state it is about.
const gcpSetupId = "13131313-1313-4313-8313-131313131313";
const gcpInstance: NonNullable<GcpApprovalInput["instance"]> = {
  id: "example-instance",
  name: "example-instance",
  engine: "postgres",
  region: "asia-northeast3",
  ready: true,
  production: false,
  iamAuthenticationEnabled: false,
};
const gcpApproval: GcpApprovalInput = {
  instance: gcpInstance,
  environment: "",
  productionApproved: false,
  iamChangeApproved: false,
  iamRoleGrantApproved: false,
  schema: { database: "", owner: "", approved: false },
  permissions: {
    account: "admin@example.test",
    projectId: "example-project",
    canAutoGrant: false,
    missing: [],
  },
};

function gcpPrepare(
  input: Partial<GcpApprovalInput>,
  repairIntegrationId: string | null = null,
) {
  return gcpPrepareOperation({
    ...gcpApproval,
    ...input,
    workspaceId: adminWorkspaceId,
    setupId: gcpSetupId,
    project: { id: "example-project", number: "123456789012", name: "Example" },
    repairIntegrationId,
  });
}

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

  it("keeps Cloud SQL IAM setting approval restart-free", () => {
    expect(gcpSetupRouteSource).toContain(
      'typeof body.approveIamAuthenticationChange !== "boolean"',
    );
    // Desktop asks for the IAM flag change only with its explicit approval and only
    // when the instance lacks the flag; no prepare field can request a restart.
    expect(gcpApprovalsComplete(gcpApproval)).toBe(false);
    expect(gcpPrepare({})).toBeNull();
    const iamChange = gcpPrepare({ iamChangeApproved: true });
    expect(iamChange).toMatchObject({
      kind: "prepareGcpSetup",
      approveIamAuthenticationChange: true,
      approveProduction: false,
      approveIamRoleGrant: false,
      repairIntegrationId: null,
    });
    expect(Object.keys(iamChange ?? {}).filter((key) => /restart/i.test(key))).toEqual([]);
    expect(gcpPrepare({
      instance: { ...gcpInstance, iamAuthenticationEnabled: true },
      iamChangeApproved: true,
    })).toMatchObject({ approveIamAuthenticationChange: false });
    expect(workspaceAdminSource("providers/gcp/GcpSetupApprovals.tsx")).toContain(
      "checked={wizard.iamChangeApproved}",
    );
    expect(workspaceAdminRoutesSource).toContain(
      "Value::Bool(*approve_iam_authentication_change)",
    );
    expect(workspaceAdminRoutesSource).not.toMatch(/restart/i);
    expect(gcpBootstrapSource).toContain(
      "approveIamAuthenticationChange",
    );
    expect(gcpBootstrapSource).not.toContain(
      "approveInstanceRestart",
    );
    expect(messages.en["workspaceProviders.gcpIamApprovalDescription"]).toContain(
      "not requiring an instance restart.",
    );
    expect(messages.ko["workspaceProviders.gcpIamApprovalDescription"]).toContain(
      "인스턴스 재시작이 필요하지 않습니다.",
    );
    for (const catalog of [messages.en, messages.ko]) {
      expect(Object.values(catalog).join("\n")).not.toMatch(
        /instance may restart while|인스턴스가 재시작될 수/,
      );
    }
    const enableIamAuthenticationSource = gcpBootstrapDatabaseSource.slice(
      gcpBootstrapDatabaseSource.indexOf(
        "export async function enableIamAuthentication",
      ),
      gcpBootstrapDatabaseSource.indexOf(
        "export async function ensureDatabaseUserOnce",
      ),
    );
    expect(enableIamAuthenticationSource).toContain('method: "PATCH"');
    expect(enableIamAuthenticationSource).not.toContain("/restart");
  });

  it("preserves existing Cloud SQL users and retains the active lease preflight", async () => {
    expect(gcpBootstrapDatabaseSource).not.toMatch(/method: "(PUT|DELETE)"|revokeExistingRoles|cloudsqlsuperuser/);
    expect(gcpBootstrapApplicationSource).not.toContain("configureDatabasePrivileges");

    expect(gcpConnectionDatabaseRoles("POSTGRES_17", false)).toEqual(["pg_read_all_data"]);
    expect(gcpConnectionDatabaseRoles("POSTGRES_17", true)).toEqual(["pg_read_all_data", "pg_write_all_data"]);
    const original = { type: "CLOUD_IAM_SERVICE_ACCOUNT", databaseRoles: ["application_role"] };
    expect(() => assertDatabaseUserRoles(original, ["pg_read_all_data"])).toThrow("Existing roles were preserved");
    expect(original.databaseRoles).toEqual(["application_role"]);
    const setupPreflight = gcpSetupRouteSource.indexOf(
      "const activeLeaseWindow = await activeIntegrationLeaseRevocationWindow",
    );
    const setupBootstrap = gcpSetupRouteSource.indexOf(
      "const result = await bootstrapGcpCloudSql",
    );
    expect(setupPreflight).toBeGreaterThanOrEqual(0);
    expect(setupBootstrap).toBeGreaterThan(setupPreflight);
    expect(gcpSetupRouteSource).toContain("gcpActiveDatabaseAccessConflict");
    expect(gcpSetupRouteSource).toContain("setup.expiresAt");
    expect(gcpCloudSqlCoreSource).toContain(
      "export async function gcpCloudSqlTargetFingerprint",
    );
    expect(providerLeaseRevocationWindowSource).toContain(
      "gt(workspaceCredentialLease.expiresAt, now)",
    );
    expect(providerLeaseRevocationWindowSource).toContain(
      '"gcp_active_database_access"',
    );
    const reconnectClaim = providerIntegrationRouteSource.indexOf(
      "reconnectClaim = await claimRevocationGate",
    );
    const reconnectPreflight = providerIntegrationRouteSource.indexOf(
      "const activeLeaseWindow = await activeIntegrationLeaseRevocationWindow",
      reconnectClaim,
    );
    const reconnectRevocation = providerIntegrationRouteSource.indexOf(
      "revocation = await revokeActiveLeases",
      reconnectPreflight,
    );
    expect(reconnectClaim).toBeGreaterThanOrEqual(0);
    expect(reconnectPreflight).toBeGreaterThan(reconnectClaim);
    expect(reconnectRevocation).toBeGreaterThan(reconnectPreflight);
    expect(gcpOAuthSource).toContain(
      "GCP_SETUP_SESSION_SECONDS = GCP_LEASE_SECONDS + 5 * 60",
    );
    expect(gcpOAuthCallbackSource).toContain(
      "GCP_SETUP_SESSION_SECONDS * 1_000",
    );

    const now = Date.parse("2026-09-01T10:00:00.000Z");
    const conflict = parseGcpActiveLeaseConflict({
      error: "Active Cloud SQL database access is still valid",
      code: "gcp_active_database_access",
      activeLeaseCount: 2,
      retryAt: "2026-09-01T10:12:00.000Z",
      setupExpiresAt: "2026-09-01T10:20:00.000Z",
    }, now);
    expect(conflict).not.toBeNull();
    expect(gcpActiveLeaseRetryMessage(
      conflict!,
      { wait: "wait:{count}:{minutes}", reconnect: "reconnect:{count}:{minutes}" },
      "en",
      now,
    )).toBe("wait:2:12");
    expect(gcpActiveLeaseRetryMessage(
      { ...conflict!, setupExpiresAt: "2026-09-01T10:14:00.000Z" },
      { wait: "wait:{count}:{minutes}", reconnect: "reconnect:{count}:{minutes}" },
      "ko",
      now,
    )).toBe("reconnect:2:12");
    expect(parseGcpActiveLeaseConflict({
      error: "Active Cloud SQL database access is still valid",
      code: "unexpected",
      activeLeaseCount: 2,
      retryAt: "2026-09-01T10:12:00.000Z",
      setupExpiresAt: "2026-09-01T10:20:00.000Z",
    }, now)).toBeNull();
    // Desktop setup turns that refusal into the localized wait or reconnect sentence;
    // both shipped templates are filled completely in each language.
    expect(workspaceAdminSource("providers/gcp/useGcpSetupWizard.ts")).toContain(
      "parseGcpActiveLeaseConflict(cause.body)",
    );
    for (const lang of ["en", "ko"] as const) {
      const copy = {
        wait: messages[lang]["workspaceProviders.gcpActiveLeaseWait"],
        reconnect: messages[lang]["workspaceProviders.gcpActiveLeaseReconnect"],
      };
      const wait = gcpActiveLeaseRetryMessage(conflict!, copy, lang, now);
      const reconnect = gcpActiveLeaseRetryMessage(
        { ...conflict!, setupExpiresAt: "2026-09-01T10:14:00.000Z" },
        copy,
        lang,
        now,
      );
      expect(wait).not.toBe(reconnect);
      for (const sentence of [wait, reconnect]) {
        expect(sentence).toContain("12");
        expect(sentence).not.toMatch(/\{(?:count|minutes|time)\}/);
      }
    }

    // The Desktop prepare request continues only the server's exact IAM-propagation
    // refusal, resending the same reviewed operation inside a bounded window.
    expect(gcpSetupRouteSource).toMatch(
      /error: error\.message,\s*code: error\.code,\s*retryAfterMs: error\.retryAfterMs,/,
    );
    // The server class itself, loaded at run time so the Desktop type-check never
    // compiles server-only modules.
    const { GcpIamPropagationPendingError } = await vi.importActual<{
      GcpIamPropagationPendingError: new () => Error & {
        status: number;
        code: string;
        retryAfterMs: number;
      };
    }>("../../../workspace-cloud/lib/providers/gcp-cloud-bootstrap-application");
    const pendingError = new GcpIamPropagationPendingError();
    expect(pendingError).toMatchObject({ status: 503, code: "gcp_iam_propagation_pending" });
    const pendingRefusal = {
      status: pendingError.status,
      body: {
        error: pendingError.message,
        code: pendingError.code,
        retryAfterMs: pendingError.retryAfterMs,
      },
    };
    const prepareOperation = gcpPrepare({ iamChangeApproved: true });
    expect(prepareOperation).not.toBeNull();
    const prepare = (
      input: Partial<Parameters<typeof prepareGcpSetupWithPropagationRetry>[0]> = {},
    ) => prepareGcpSetupWithPropagationRetry({
      accountId: adminAccountId,
      operation: prepareOperation!,
      setupExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      signal: new AbortController().signal,
      onIamPending: vi.fn(),
      ...input,
    });
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    try {
      // Seven minutes of propagation refusals do not exhaust the attempt; only the
      // eventual verified body reaches the caller, and every request is identical.
      const continuedStart = Date.now();
      invokeMock.mockReset().mockImplementation(async () => (
        Date.now() - continuedStart < 7 * 60_000
          ? pendingRefusal
          : { status: 200, body: { bootstrapTicket: "fixture-verified-ticket" } }
      ));
      const onIamPending = vi.fn();
      const continued = prepare({ onIamPending });
      await vi.runAllTimersAsync();
      await expect(continued).resolves.toEqual({ bootstrapTicket: "fixture-verified-ticket" });
      expect(onIamPending).toHaveBeenCalled();
      expect(invokeMock.mock.calls.length).toBeGreaterThan(1);
      for (const call of invokeMock.mock.calls) {
        expect(call).toEqual([
          "workspace_admin_request",
          { request: { accountId: adminAccountId, operation: prepareOperation } },
        ]);
      }

      // Workspace authorization, active leases, expired setups, upstream denials,
      // unrelated or out-of-bounds 503s and transport failures are never resent.
      for (const refusal of [
        ...[401, 403, 409, 410, 424, 503].map((status) => ({
          status,
          body: { error: "fixture denial" },
        })),
        { ...pendingRefusal, body: { ...pendingRefusal.body, retryAfterMs: 60_000 } },
      ]) {
        invokeMock.mockReset().mockResolvedValue(refusal);
        await expect(prepare()).rejects.toMatchObject({
          name: "WorkspaceAdminRequestError",
          status: refusal.status,
        });
        expect(invokeMock).toHaveBeenCalledTimes(1);
      }
      invokeMock.mockReset().mockRejectedValue(new Error("fixture network failure"));
      await expect(prepare()).rejects.toThrow("fixture network failure");
      expect(invokeMock).toHaveBeenCalledTimes(1);

      // A context change cancels the wait without starting another request.
      invokeMock.mockReset().mockResolvedValue(pendingRefusal);
      const controller = new AbortController();
      const cancelled = prepare({
        signal: controller.signal,
        onIamPending: () => controller.abort(),
      }).catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await cancelled).toBeInstanceOf(GcpBootstrapCancelled);
      expect(invokeMock).toHaveBeenCalledTimes(1);

      // Persistent propagation has a finite budget and keeps the actionable refusal.
      invokeMock.mockClear();
      const boundedStart = Date.now();
      const bounded = prepare().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      const exhausted = await bounded;
      expect(exhausted).toBeInstanceOf(WorkspaceAdminRequestError);
      expect(exhausted).toMatchObject({ status: 503, code: "gcp_iam_propagation_pending" });
      expect(Date.now() - boundedStart).toBeLessThanOrEqual(10 * 60_000);
      expect(invokeMock.mock.calls.length).toBeLessThanOrEqual(120);

      // A setup authorization a minute from expiry is never sent.
      invokeMock.mockClear();
      await expect(prepare({
        setupExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      })).rejects.toBeInstanceOf(GcpSetupExpired);
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("rejects removed provider identity and manual GCP trust input", async () => {
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
    expect(workspaceAdminSource("providers/gcp/GcpSetupWizard.tsx")).toContain(
      't("workspaceProviders.gcpConfigure")',
    );
    expect(messages.en["workspaceProviders.gcpConfigure"]).toBe("Configure and connect");
    expect(messages.ko["workspaceProviders.gcpConfigure"]).toBe("자동 설정하고 연결");
    // Google Cloud trust is created by the reviewed setup itself: no Desktop module
    // or administration route accepts a hand-entered pool, provider or account.
    for (const [modulePath, source] of Object.entries(workspaceAdminSources)) {
      expect(source, modulePath).not.toMatch(
        /workloadIdentityPoolId|workloadIdentityProviderId|readServiceAccountEmail/,
      );
    }
    expect(workspaceAdminRoutesSource).not.toMatch(
      /workload_identity_pool|workload_identity_provider|service_account_email/,
    );
    // Only providers Desktop can connect, or that still own accounts, get a row;
    // nothing renders an availability placeholder for the rest.
    const catalogProvider = (
      id: string,
      setupKind: Provider["setupKind"],
      configured = true,
    ): Provider => ({
      id,
      name: id,
      configured,
      note: "",
      leaseSeconds: 900,
      setupKind,
      supportedEngines: ["postgres"],
      resourceLevels: [
        { key: "project", kind: "projects", label: "Project" },
        { key: "branch", kind: "branches", label: "Branch" },
        { key: "database", kind: "databases", label: "Database" },
      ],
    });
    const neonAccount: Integration = {
      id: "18181818-1818-4818-8818-181818181818",
      provider: "neon",
      status: "active",
      generation: "3",
      displayName: "Neon · app",
      grantedScope: "api-key-v1:personal:broad:projects:3:0123456789abcdef",
      updatedAt: "2026-09-01T10:00:00.000Z",
      credentialMode: "managed",
    };
    expect(connectableProvider(catalogProvider("neon", "apiKey"))).toBe("neon");
    expect(connectableProvider(catalogProvider("neon", "apiKey", false))).toBeNull();
    expect(connectableProvider(catalogProvider("neon", "oauth"))).toBeNull();
    expect(providerAccountGroups([
      catalogProvider("planetScale", "oauth"),
      catalogProvider("gcpCloudSql", "oauth", false),
      catalogProvider("neon", "apiKey", false),
    ], [neonAccount]).map((group) => [group.id, group.connectable])).toEqual([
      ["planetScale", "planetScale"],
      ["neon", null],
    ]);
    for (const [modulePath, source] of workspaceAdminModulesUnder("providers/accounts/")) {
      expect(source, modulePath).not.toMatch(/availability|"준비 중"/);
    }
    // An unknown managed-database inventory is never shown as zero databases.
    expect(managedDatabaseCount(null, neonAccount.id)).toBeNull();
    expect(managedDatabaseCount([], neonAccount.id)).toBe(0);
    // Personal broad-scope Neon keys keep their warning on the account row.
    expect(hasBroadNeonKey(neonAccount)).toBe(true);
    expect(hasBroadNeonKey({
      ...neonAccount,
      grantedScope: "api-key-v1:organization:scoped:projects:1:0123456789abcdef",
    })).toBe(false);
    expect(hasBroadNeonKey({ ...neonAccount, provider: "planetScale" })).toBe(false);
    expect(workspaceAdminSource("providers/accounts/ProviderAccountRow.tsx")).toContain(
      "hasBroadNeonKey(integration)",
    );
    const neonConnectDialogSource = workspaceAdminSource("providers/accounts/NeonConnectDialog.tsx");
    expect(neonConnectDialogSource).toContain('t("workspaceProviders.neonIntro")');
    expect(neonConnectDialogSource).toContain('"workspaceProviders.neonGuideOrganizationPath"');
    expect(neonConnectDialogSource).toContain("projectId: form.projectId.trim() || null");
    expect(messages.en["workspaceProviders.neonIntro"]).toContain("connects with an API key");
    expect(messages.ko["workspaceProviders.neonIntro"]).toContain("API 키로 연결합니다");
    expect(providerCatalogSource).not.toMatch(
      /supportsReadWrite|availability|awsRds|oracleOci|mongodbAtlas/,
    );
    expect(providerCatalogSource.match(/id: "(planetScale|gcpCloudSql|neon|vault)"/g))
      .toHaveLength(4);
    expect(workspaceAdminSource("providers/accounts/VaultConnectDialog.tsx")).toContain(
      't("workspaceProviders.vaultCaution")',
    );
    expect(vaultProviderSource).toContain("env.vaultBrokerOrigins().includes(url.origin)");
    expect(vaultProviderSource).toContain('redirect: "error"');
    expect(vaultProviderSource).toContain("VAULT_MAX_DATABASE_LEASE_SECONDS");
    expect(vaultProviderSource).toContain('"auth/token/revoke-self"');
    expect(providerIntegrationRouteSource).toContain("id: provider.id");
    expect(providerIntegrationRouteSource).not.toContain("...provider,");
    expect(gcpOAuthSource).toContain('"/api/auth/callback/google"');
    expect(authRouteSource).toContain("isGcpCloudSetupCallback");
    expect(gcpBootstrapSource).toContain("verifyWorkloadOidcToken");
    expect(gcpBootstrapSource).toContain("roles/iam.workloadIdentityUser");
    expect(gcpBootstrapSource).not.toContain("configureDatabasePrivileges");
    expect(gcpBootstrapSource).toContain("pg_write_all_data");

    expect(gcpBootstrapIamSource).not.toContain("grantSchemaPolicyInspection");
    expect(gcpBootstrapIamSource).toContain("createdAccounts.get(credential)?.delete");
    expect(gcpBootstrapIamSource).toContain("expected.members.filter");
    expect(gcpBootstrapIamSource).toContain("matching.members.push(...missingMembers)");
    expect(gcpCloudSqlCoreSource).toContain("GCP_SCHEMA_LEASE_SECONDS = 10 * 60");
    expect(gcpCloudSqlSource).toContain("verifyGcpSchemaServiceAccountPolicy");
    expect(gcpSchemaAuthoritySource).toContain("iam.serviceAccountViewer");
    expect(gcpSchemaAuthoritySource).toContain("gcpWifPrincipal(credential)");
    expect(gcpCloudSqlSource).toContain("GCP_SCHEMA_LEASE_SECONDS");
    expect(providerLeaseIssuanceSource).toContain(
      'input.integration.provider !== "gcpCloudSql"',
    );
    expect(workspaceRevocationGatesSource).toContain("('neon', 'gcpCloudSql')");
    expect(workspaceConnectionsSource).toContain(
      'input.provider === "neon" || input.provider === "gcpCloudSql"',
    );
    expect(desktopSchemaPolicySource).toContain(
      "GCP schema authority check failed",
    );
    expect(workspaceBaselineSource).toContain("'read', 'write', 'schema'");
    expect(gcpConnectionPolicySource).not.toContain("cloudsqlsuperuser TO");
    const schemaCredential = parseGcpCloudSqlCredential({
      projectId: "example-project",
      projectNumber: "123456789012",
      workloadIdentityPoolId: "dopedb-pool",
      workloadIdentityProviderId: "dopedb-provider",
      instanceId: "example-instance",
      readServiceAccountEmail:
        "dopedb-r-0123456789abcd@example-project.iam.gserviceaccount.com",
      writeServiceAccountEmail:
        "dopedb-w-0123456789abcd@example-project.iam.gserviceaccount.com",
      schemaServiceAccountEmail:
        "dopedb-s-0123456789abcd@example-project.iam.gserviceaccount.com",
      workloadIdentitySubject:
        "dopedb:workspace:production",
      databaseNames: ["app"],
      dedicatedServiceAccountsConfirmed: true,
      instanceScopedIamConfirmed: true,
    });
    const delegated = { ...schemaCredential, schemaAuthority: { database: "app", owner: "migration_owner" } };
    expect(parseGcpCloudSqlCredential(delegated).schemaAuthority).toEqual(delegated.schemaAuthority);
    for (const authority of [null, { database: "other", owner: "migration_owner" },
      { database: "app", owner: "postgres" }, { database: "app", owner: "pg_read_all_data" },
      { database: "app", owner: "owner;RESET ROLE" }, { database: "app", owner: "migration_owner", extra: true }]) {
      expect(() => parseGcpCloudSqlCredential({ ...schemaCredential, schemaAuthority: authority })).toThrow();
    }
    expect(() => parseGcpCloudSqlCredential({ ...delegated, schemaServiceAccountEmail: null })).toThrow();
    expect((await gcpCloudSqlIntegrationIdentity(delegated)).externalAccountId)
      .not.toEqual((await gcpCloudSqlIntegrationIdentity(schemaCredential)).externalAccountId);
    expect(gcpCloudSqlPrincipalClaims(
      await gcpCloudSqlIntegrationIdentity(schemaCredential),
    ).map((claim) => claim.accessKind)).toEqual(["read", "write", "schema"]);
    expect(parseGcpCloudSqlCredential({
      ...schemaCredential,
      schemaServiceAccountEmail: undefined,
      workloadIdentitySubject: undefined,
    })).toMatchObject({
      schemaServiceAccountEmail: null,
      workloadIdentitySubject: null,
    });
    expect(gcpCloudSqlSource).not.toContain("gcpSchemaDatabaseExecutor");
    expect(desktopSchemaPolicySource).toContain("exact_schema_owner");
    expect(desktopRuntimePolicySource).toContain("sql.rw()?");
    expect(desktopRuntimePolicySource).not.toContain("safe_policy_admin");
    expect(desktopRuntimePolicySource).not.toContain("dopedb_a_");
    expect(desktopSchemaPolicySource).toContain("cloudsqliamserviceaccount");
    expect(desktopSchemaPolicySource).toContain("m.roleid = lease.oid");
    expect(desktopSchemaPolicySource).toContain("safe_system_role");
    expect(desktopSchemaPolicySource).toContain("no_public_managed_routine");
    expect(gcpBootstrapSource).toContain("roles/serviceusage.serviceUsageConsumer");
    expect(gcpBootstrapSource).toContain("reconnect will not change existing users or permissions");
    expect(gcpCloudSqlHttpSource).toContain("logGcpManagedAccessUpstreamRejection");
    expect(gcpCloudSqlHttpSource).toContain("MAX_TRANSIENT_REQUEST_ATTEMPTS = 3");
    expect(gcpCloudSqlHttpSource).toContain("waitForTransientRetry(attempt, deadline)");
    expect(gcpCloudSqlHttpSource).toContain(
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
    expect(gcpCloudSqlHttpSource).toContain("Cloud SQL Admin denied the managed access check");
    expect(gcpCloudSqlSource).toContain('"x-goog-user-project": credential.projectId');
    expect(gcpCloudSqlSource).toContain("Cloud SQL instance identity changed during verification");
    expect(gcpCloudSqlSource).toContain("return { providerAuditId: connectionName }");
    expect(gcpCloudSqlSource).not.toContain("iamDatabaseUsersWithToken");
    expect(providerIntegrationDomainSource).toContain('networkMode: "PUBLIC"');
    expect(providerIntegrationDomainSource).not.toContain(
      'networkMode: input.selection.networkMode || "PRIVATE_SERVICES_ACCESS"',
    );
    expect(hostedControlPlaneSource).toContain(".or(value.error.as_deref())");
    expect(
      connectionActionRouteSource.match(/managed_connection_recovery_required/g),
    ).toHaveLength(1);
    expect(hostedControlPlaneSource).toContain(
      "managedConnectionRecoveryRequired",
    );
    expect(gcpSetupRouteSource).toContain("writeAccess: true");
    expect(gcpSetupRouteSource).toContain("matchesManagedGcpRepairTarget");
    expect(gcpSetupRouteSource).toContain('eq(workspaceConnection.credentialMode, "managed")');
    // Desktop repairs managed access only for members who manage the database:
    // Cloud SQL pins the server-projected target in memory for one browser
    // authorization, and other providers reconnect the account that serves it.
    const repairConnection = {
      id: connectionId,
      name: "Shared production",
      engine: "postgres",
      credentialMode: "managed",
      allowWrites: false,
      revision: 4,
      accessMode: "manage",
    } as const;
    const repairManaged = {
      connectionId,
      integrationId,
      provider: "gcpCloudSql",
      resource: {
        project: "example-project",
        instance: "example-instance",
        database: "app",
        password: "must-not-pass",
      },
    };
    expect(canRepairManagedAccess(repairConnection, repairManaged)).toBe(true);
    expect(canRepairManagedAccess({ ...repairConnection, accessMode: "write" }, repairManaged))
      .toBe(false);
    expect(canRepairManagedAccess(repairConnection, { ...repairManaged, provider: "neon" }))
      .toBe(true);
    expect(canRepairManagedAccess(repairConnection, null)).toBe(false);
    expect(workspaceAdminSource("providers/databases/SharedDatabaseRow.tsx")).toContain(
      "onRepair(managed)",
    );
    // Only identifiers and the pinned project, instance and database travel.
    const repairTarget = gcpRepairTarget(repairManaged);
    expect(repairTarget).toEqual({
      connectionId,
      integrationId,
      resource: { project: "example-project", instance: "example-instance", database: "app" },
    });
    expect(JSON.stringify(repairTarget)).not.toMatch(
      /password|accessToken|refreshToken|credential|must-not-pass/i,
    );
    expect(gcpRepairTarget({ ...repairManaged, provider: "neon" })).toBeNull();
    expect(gcpRepairTarget({ ...repairManaged, integrationId: "not-an-integration" })).toBeNull();
    // The intent belongs to one account and workspace, lasts fifteen minutes, is
    // discarded by any other read, and is never written to browser storage.
    const repairScope = { accountId: adminAccountId, workspaceId: adminWorkspaceId };
    const repairStartedAt = Date.parse("2026-09-01T10:00:00.000Z");
    rememberGcpRepair(repairScope, repairTarget!, repairStartedAt);
    expect(pendingGcpRepair({
      ...repairScope,
      workspaceId: workspaceIdentity("19191919-1919-4919-8919-191919191919"),
    }, repairStartedAt)).toBeNull();
    expect(pendingGcpRepair(repairScope, repairStartedAt)).toBeNull();
    rememberGcpRepair(repairScope, repairTarget!, repairStartedAt);
    expect(pendingGcpRepair(repairScope, repairStartedAt + 15 * 60_000)).toEqual(repairTarget);
    expect(pendingGcpRepair(repairScope, repairStartedAt + 15 * 60_000 + 1)).toBeNull();
    expect(pendingGcpRepair(repairScope, repairStartedAt)).toBeNull();
    rememberGcpRepair(repairScope, repairTarget!, repairStartedAt);
    forgetGcpRepair();
    expect(pendingGcpRepair(repairScope, repairStartedAt)).toBeNull();
    expect(workspaceAdminSource("providers/accounts/useProviderAuthorization.ts")).toContain(
      "rememberGcpRepair(scope, request.repair)",
    );
    // The repair keeps its project and instance and names only its own integration.
    expect(gcpPrepare({ iamChangeApproved: true }, integrationId)).toMatchObject({
      repairIntegrationId: integrationId,
    });
    const gcpSetupController = workspaceAdminSource("providers/gcp/useGcpSetupWizard.ts");
    expect(gcpSetupController).toContain(
      "const projectId = repair ? repair.resource.project : projectChoice;",
    );
    expect(gcpSetupController).toContain(
      "const instanceId = repair ? repair.resource.instance : instanceChoice;",
    );
    expect(gcpSetupController).toContain("repair && integrationId !== repair.integrationId");
    expect(workspaceAdminSource("providers/gcp/GcpSetupWizard.tsx")).toContain(
      't("workspaceProviders.gcpPinnedTitle")',
    );
    expect(providerIntegrationRouteSource).toContain(
      "requestedRepairIntegrationId",
    );
    expect(providerIntegrationRouteSource).toContain(
      "The managed Cloud SQL repair target changed",
    );
    expect(managedLeaseRouteSource).toContain(
      'let requestedAccessMode: "read" | "write" | "schema"',
    );
    expect(managedLeaseRouteSource).toContain(
      "providerSchemaSetupRequired",
    );
    expect(managedLeaseRouteSource).toContain("Reconnecting only restores data access");
    // Data leases mark provider and target mismatches for repair; a schema lease
    // never promises that reconnecting restores schema access.
    expect(managedLeaseRouteSource).toContain(
      'const recoveryRequired = (message: string) => requestedAccessMode === "schema"',
    );
    expect(managedLeaseRouteSource).toContain(
      "jsonError(message, 409, MANAGED_CONNECTION_RECOVERY_REQUIRED)",
    );
    expect(managedLeaseRouteSource).toContain(
      "jsonError(error.message, 409, MANAGED_LEASE_AUTHORITY_CHANGED)",
    );
    expect(managedLeaseRouteSource).not.toMatch(/access-v3|access-v4|LEGACY_MANAGED/);
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
      '"credential.lease.cleanup_deferred"',
    );
    expect(providerLeaseCleanupSource).toContain(
      "'providerAuditId', provider_audit_id",
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
      "jsonEqual(workspaceConnection.providerResource, workspaceProviderResource.resource)",
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
    expect(neonCoreSource).not.toContain("ALTER DEFAULT PRIVILEGES FOR ROLE");
    expect(neonCoreSource).toContain("NEON_CREDENTIAL_SCHEMA_VERSION = 2");
    expect(neonCoreSource).toContain("parseNeonCredential");
    expect(neonCoreSource).toContain(
      "row.schemaVersion !== NEON_CREDENTIAL_SCHEMA_VERSION",
    );
    expect(neonCoreSource).not.toContain("row.schemaVersion !== 1");
    expect(neonCoreSource).toContain("projectId: row.projectId as string | null");
    expect(neonCoreSource).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES");
    expect(neonManagedAccessSource).toContain("Existing ownership and role memberships were preserved");
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
    expect(remoteStartFence).toContain("await atomicD1({");
    expect(remoteStartFence).toContain("authorized_operation.\"resource_scope\"");
    expect(remoteStartFence).toContain("authorized_operation.\"source_resource_id\"");
    expect(remoteStartFence).toContain("workspaceCredentialLease");
    expect(remoteStartFence).toContain('active_lease."expires_at" > ${utcNow}');
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
    expect(bootstrapCompletionStart).toBeGreaterThanOrEqual(0);
    // Atomic audit rollback and concurrent claims run in the native D1 harness;
    // PostgreSQL CTE ordering is no longer the persistence contract.
    expect(providerOperationBootstrapSource).toContain("await atomicD1({");
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
      'operation."plan_expires_at" > ${utcNow}',
    );
    expect(providerOperationStoreSource).toContain(
      'idempotency_key = ${input.idempotencyKey}',
    );
    expect(providerOperationStoreSource).toContain("INSERT INTO workspace_audit_event");
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
    expect(switchCompletion).toContain("content_revision = content_revision + 1");
    expect(switchCompletion).toContain("provider_resource_id = (SELECT json_extract(payload, '$.targetId') FROM (${scope}))");
    expect(switchCompletion).toContain("connection.provider_target.switch");
    expect(workspaceBaselineSource).toContain(
      '`approval_policy` text NOT NULL',
    );
    expect(workspaceBaselineSource).toContain("'remote_started'");
    expect(workspaceBaselineSource).toContain("'separate_admin'");
    expect(workspaceBaselineSource).toContain(
      'FOREIGN KEY (`organization_id`,`integration_id`,`provider`)',
    );
    expect(workspaceBaselineSource).toContain(
      "'neon.branch.create', 'neon.branch.delete'",
    );
    expect(workspaceBaselineSource).toContain("'neon.branch.switch'");
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
    // Neon least-privilege preparation accepts only a self-consistent sealed report:
    // a blocker blocks, a PUBLIC change asks for its approval, production asks for
    // production approval, and no extra or expired field is carried forward.
    const neonFinding = {
      code: "NEON_REVOKE_PUBLIC_DATABASE_CONNECT",
      level: "change",
      description: "Revoke PUBLIC CONNECT on the managed database",
      target: "database app",
      before: "PUBLIC CONNECT",
      after: "no PUBLIC CONNECT",
      requiresApproval: "publicAcl",
      rollbackAvailable: true,
    };
    const neonReport = {
      version: 1,
      status: "approvalRequired",
      planHash: "c".repeat(64),
      providerAuditId: "br-main:123456789",
      production: false,
      target: {
        project: "project-one",
        branch: "br-main",
        databaseId: "123456789",
        database: "app",
        schemas: ["public"],
      },
      findings: [neonFinding],
      requiresPublicAclApproval: true,
      requiresProductionApproval: false,
      canRollback: true,
    };
    const neonPlanExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const neonPreflight = {
      report: neonReport,
      plan: "p".repeat(80),
      planExpiresAt: neonPlanExpiresAt,
    };
    expect(parseNeonBootstrapPreflight(neonPreflight)?.report.status).toBe("approvalRequired");
    for (const forged of [
      { ...neonPreflight, receipt: "must-not-pass" },
      { ...neonPreflight, planExpiresAt: new Date(Date.now() - 1_000).toISOString() },
      { ...neonPreflight, report: { ...neonReport, status: "readyToApply" } },
      { ...neonPreflight, report: { ...neonReport, requiresPublicAclApproval: false } },
      { ...neonPreflight, report: { ...neonReport, findings: [{ ...neonFinding, level: "blocker" }] } },
      { ...neonPreflight, report: { ...neonReport, production: true } },
    ]) {
      expect(parseNeonBootstrapPreflight(forged)).toBeNull();
    }
    const neonApply = {
      report: {
        ...neonReport,
        status: "readyToApply",
        findings: [{ ...neonFinding, level: "verified", requiresApproval: null }],
        requiresPublicAclApproval: false,
      },
      receipt: "16161616-1616-4616-8616-161616161616",
      receiptExpiresAt: neonPlanExpiresAt,
    };
    expect(parseNeonBootstrapApply(neonApply)?.receipt).toBe(neonApply.receipt);
    expect(parseNeonBootstrapApply({ ...neonApply, receipt: "not-a-receipt" })).toBeNull();
    expect(parseNeonBootstrapApply({ ...neonApply, plan: "must-not-pass" })).toBeNull();
    const neonBootstrapController = workspaceAdminSource("providers/databases/useNeonBootstrap.ts");
    expect(neonBootstrapController).toContain('kind: "preflightNeonBootstrap"');
    expect(neonBootstrapController).toContain('kind: "applyNeonBootstrap"');
    // A retried apply of the same sealed plan and approvals reuses its key.
    expect(neonBootstrapController).toContain("idempotencyKey: pending.idempotencyKey");
    expect(workspaceAdminRoutesSource).toContain('"action": "preflight"');
    expect(workspaceAdminRoutesSource).toContain('"action": "apply"');
    const neonBootstrapPanel = workspaceAdminSource("providers/databases/NeonBootstrapPanel.tsx");
    expect(neonBootstrapPanel).toContain('t("workspaceProviderDatabases.neonTitle")');
    expect(neonBootstrapPanel).toContain('t("workspaceProviderDatabases.publicApproval")');
    expect(messages.en["workspaceProviderDatabases.neonTitle"])
      .toBe("Prepare Neon least-privilege access");
    expect(messages.ko["workspaceProviderDatabases.neonTitle"]).toBe("Neon 최소 권한 준비");
    expect(messages.ko["workspaceProviderDatabases.publicApproval"])
      .toBe("기존 PUBLIC 권한은 별도 관리자 검토가 필요합니다");
    // Adding a database never offers a setup terminal or SQL input, and an import
    // always creates its own connection instead of replacing an existing one.
    for (const [modulePath, source] of workspaceAdminModulesUnder("providers/databases/")) {
      expect(source, modulePath).not.toMatch(
        /setup terminal|SQL 입력|ImportIntent|replaceTitle|replaceDescription|replaceButton/i,
      );
    }
    for (const lang of ["en", "ko"] as const) {
      for (const [key, value] of Object.entries(messages[lang])) {
        if (key.startsWith("workspaceProviderDatabases.")) {
          expect(value, key).not.toMatch(/setup terminal|SQL 입력/i);
        }
      }
    }
    const importOperation = workspaceAdminSource("domain.ts")
      .match(/kind: "importProviderResource";[^}]*\}/)?.[0] ?? "";
    expect(importOperation).toContain("receipt: string;");
    expect(importOperation).not.toContain("connectionId");
    const importRoute = workspaceAdminRoutesSource.slice(
      workspaceAdminRoutesSource.indexOf("Op::ImportProviderResource {"),
      workspaceAdminRoutesSource.indexOf("Op::PreflightNeonBootstrap {"),
    );
    expect(importRoute).toContain('&["imports"]');
    expect(importRoute).not.toMatch(/connection_id|connectionId/);
    // Neon branch views ask the manager for plans in the shipped language only.
    const neonBranchViewSource = workspaceAdminModulesUnder("providers/neonBranches/")
      .filter(([modulePath]) => modulePath.endsWith(".tsx"))
      .map(([, source]) => source)
      .join("\n");
    for (const key of [
      "workspaceNeonBranches.createNoChangePlan",
      "workspaceNeonBranches.productionCopyNotice",
      "workspaceNeonBranches.createDeletePlan",
      "workspaceNeonBranches.createSwitchPlan",
      "workspaceNeonBranches.switchDescription",
      "workspaceNeonBranches.safeRun.title",
      "workspaceNeonBranches.safeRun.returnPlan",
    ]) {
      expect(neonBranchViewSource).toContain(`"${key}"`);
    }
    expect(messages.en["workspaceNeonBranches.createNoChangePlan"]).toBe("Create no-change plan");
    expect(messages.ko["workspaceNeonBranches.createNoChangePlan"]).toBe("변경 없는 계획 만들기");

    // Desktop administration reaches the control plane only through the typed
    // workspace_admin IPC: no module fetches, builds an API path or header, keeps
    // browser storage, or asks through a native browser dialog.
    for (const [modulePath, source] of Object.entries(workspaceAdminSources)) {
      expect(source, modulePath).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|\/api\/v1\/|x-dopedb-|sessionStorage|localStorage|document\.cookie|window\.(?:confirm|alert|prompt)\b/,
      );
      expect(source.includes("invoke("), modulePath)
        .toBe(modulePath === "../workspaceAdmin/tauriAdapter.ts");
    }
    // Removing a shared database is manager-only and revision-pinned: Desktop sends
    // the listed revision and only Rust turns it into DELETE plus the dedicated header.
    expect(canRemoveSharedConnection(repairConnection)).toBe(true);
    for (const connection of [
      { ...repairConnection, accessMode: "write" },
      { ...repairConnection, revision: 0 },
      { ...repairConnection, revision: 1.5 },
    ] as const) {
      expect(canRemoveSharedConnection(connection)).toBe(false);
    }
    const sharedDatabasesView = workspaceAdminSource("providers/databases/SharedDatabasesView.tsx");
    expect(sharedDatabasesView).toContain('kind: "deleteSharedConnection"');
    expect(sharedDatabasesView).toContain("expectedRevision: connection.revision");
    const deleteRoute = workspaceAdminRoutesSource.slice(
      workspaceAdminRoutesSource.indexOf("Op::DeleteSharedConnection {"),
      workspaceAdminRoutesSource.indexOf("Op::GetLifecycle {"),
    );
    expect(deleteRoute).toContain("AdminRoute::delete(connection_path(");
    expect(deleteRoute).toContain(".with_expected_revision(*expected_revision)?");
    expect(workspaceAdminAdapterSource).toContain(
      "builder.header(EXPECTED_REVISION_HEADER, revision.to_string())",
    );
    expect(hostedControlPlaneSource).toContain(
      'EXPECTED_REVISION_HEADER: &str = "x-dopedb-expected-revision"',
    );
    // The destructive command waits for an in-app confirmation naming the database;
    // a recovery request reveals its database once and leads with the repair.
    const sharedDatabaseRow = workspaceAdminSource("providers/databases/SharedDatabaseRow.tsx");
    expect(sharedDatabaseRow).toContain("<ConfirmButton");
    expect(sharedDatabaseRow).toContain(
      't("workspaceProviderDatabases.removeConfirm", { name: connection.name })',
    );
    expect(sharedDatabaseRow).toContain("onConfirm={() => onRemove(connection)}");
    expect(sharedDatabaseRow).toContain('"workspaceProviderDatabases.focusRepair"');
    expect(sharedDatabaseRow).toContain('t("workspaceProviderDatabases.openAccounts")');
    expect(workspaceAdminSource("providers/ProvidersPanel.tsx")).toContain(
      "useState(() => takePendingWorkspaceAdminFocus())",
    );
    // Database access shows the workspace write ceiling as status only: it changes
    // in Settings → Safety, and no administration operation can toggle it.
    const databaseAccess = workspaceAdminSource("access/DatabaseAccess.tsx");
    expect(databaseAccess).toContain('t("workspaceAccess.writeCeiling")');
    expect(databaseAccess).toContain('t("workspaceAccess.writeCeilingHint")');
    expect(databaseAccess).not.toMatch(/CheckboxField|type="checkbox"|<Switch\b/);
    expect(messages.en["workspaceAccess.writeCeilingHint"]).toContain("Settings → Safety");
    expect(messages.ko["workspaceAccess.writeCeilingHint"]).toContain("설정 → 안전");
    expect(workspaceAdminSource("domain.ts")).not.toMatch(/allowWrites|writePolicy|WritePolicy/);
    const connectionAccessPanel = workspaceAdminSource("access/ConnectionAccessPanel.tsx");
    expect(connectionAccessPanel).toContain('t("workspaceAccess.loadingDatabases")');
    expect(connectionAccessPanel).toContain('t("workspaceAdmin.retry")');
    // A response for another account or workspace can never fill this one's view.
    const adminScope = {
      accountId: adminAccountId,
      workspaceId: adminWorkspaceId,
      workspaceName: "Example",
      role: "owner",
      canManage: true,
      isOwner: true,
    } as const;
    const otherWorkspaceId = workspaceIdentity("1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a");
    expect(sharedDatabasesQuery(adminScope).queryKey).toEqual([
      "workspaceAdmin",
      adminAccountId,
      adminWorkspaceId,
      "access",
      "databases",
    ]);
    expect(sharedDatabasesQuery({ ...adminScope, workspaceId: otherWorkspaceId }).queryKey)
      .not.toEqual(sharedDatabasesQuery(adminScope).queryKey);
    expect(workspaceAdminDialogSource).toContain(
      "<Fragment key={`${scope.accountId}:${scope.workspaceId}`}>",
    );
    expect(parseMemberDirectory({
      workspaceId: adminWorkspaceId,
      members: [],
      invitations: [],
    }, adminWorkspaceId)).toEqual({ members: [], invitations: [] });
    expect(() => parseMemberDirectory({
      workspaceId: otherWorkspaceId,
      members: [],
      invitations: [],
    }, adminWorkspaceId)).toThrow();
    const membersPanel = workspaceAdminSource("members/MembersPanel.tsx");
    expect(membersPanel).toContain("<Skeleton");
    expect(membersPanel).toContain('t("workspaceMembers.empty")');
    expect(publicAnalysisPageSource).toContain("copy.publicationDescription");
    expect(publicAnalysisPageSource).toContain(
      'dateTime={result.publishedAt.toISOString()}',
    );
    expect(publicAnalysisArticleSource).toContain('timeZone: "UTC"');
    expect(workspaceNotFoundSource).toContain("copy.unavailablePublicBody");
    expect(workspaceErrorBoundarySource).toContain("copy.unexpectedBody");
    expect(articleSharingCopySource).toContain(
      "No Article details or saved query were exposed.",
    );
    expect(articleSharingCopySource).toContain(
      "아티클 정보와 저장된 쿼리는 노출하지 않았습니다.",
    );
    expect(safetySettingsScreenSource).toContain("hasUnsavedChanges");
    expect(safetySettingsScreenSource).toContain('variant="primary"');
    expect(safetySettingsScreenSource).toContain('t("safety.unsavedChanges")');
    expect(safetySettingsScreenSource).toContain(
      "claimSafetySave(connectionId)",
    );
    expect(safetySettingsScreenSource).toContain(
      "viewRef.current.generation === requestGeneration",
    );
    expect(safetySettingsScreenSource).toContain(
      "draft?.connectionId === connectionId",
    );
    expect(safetySettingsScreenSource).toContain('disabledBehavior="focusable"');
    expect(safetySettingsScreenSource).toContain('aria-busy={busy || undefined}');
    expect(safetySettingsScreenSource).toContain('role="status"');
    expect(safetySettingsScreenSource).toContain('aria-atomic="true"');
    expect(safetySettingsScreenSource).toContain('t("safety.applying")');
    expect(safetySettingsScreenSource).toContain(
      "saveError?.connectionId === connectionId",
    );
    expect(messages.en["workspaceProviderDatabases.remove"]).toBe("Remove shared database");
    expect(messages.ko["workspaceProviderDatabases.remove"]).toBe("공유 DB 제거");
    expect(neonBranchViewSource).not.toMatch(/>Switch<|>Restore<|>Delete</);
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
      "member.role IN ('admin', 'owner')",
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
    expect(providerImportStoreSource).toContain("FROM (${fresh})");
    expect(providerImportStoreSource).toContain("productionApproved: input.productionApproved");
    expect(providerImportStoreSource).toContain("await atomicD1({");
    expect(providerImportStoreSource).toContain("WHEN valid.blocked OR EXISTS");
    expect(providerImportStoreSource).toContain(
      "mutation.kind = 'neon.branch.delete'",
    );
    expect(providerImportStoreSource).toContain(
      "mutation.kind = 'neon.branch.switch'",
    );
    expect(providerImportStoreSource).toContain(
      "'approved', 'claimed', 'remote_started', 'reconciling', 'succeeded'",
    );
    expect(providerImportStoreSource).toContain("'connection.provider_import'");
    expect(providerImportStoreSource).not.toMatch(
      /connection\.provider_migrate|preservedConnectionId|\breplacing\b|input\.connectionId/,
    );
    expect(providerImportRouteSource).not.toContain("connectionId");
    expect(providerImportRouteSource).toContain(
      "Object.keys(body).length !== fields.length",
    );

    expect(workspaceBackupCoreSource).toContain("...parseSharedConnection(template)");
    expect(workspaceBackupCoreSource).not.toContain("parseBackupConnection");
    expect(workspaceKmsSource).toContain("await workloadOidcToken()");
    expect(workspaceKmsSource).not.toContain("request.headers");
    expect(workspaceKmsSource).toContain("https://sts.googleapis.com/v1/token");
    expect(workspaceKmsSource).toContain(":generateAccessToken");
    expect(workspaceKmsSource).not.toMatch(
      /GOOGLE_APPLICATION_CREDENTIALS|private_key|client_email|serviceAccountKey/i,
    );
    expect(workspaceDataKeySource).toContain("plaintextKey.fill(0)");
    expect(workspaceDataKeySource).toContain("workspace-data-key:");
    expect(workspaceBackupSource).toContain("openWorkspaceMetadataBackupWithKms");
    expect(workspaceDataKeyRotationSource).toContain('role: "owner" }, ["owner"]');
    expect(workspaceDataKeyRotationSource).toContain("SET wrapped_key = NULL");
    expect(workspaceBaselineSource).toContain('CREATE TABLE `workspace_data_key`');
    expect(workspaceBaselineSource).toContain('CREATE TABLE `workspace_deletion_receipt`');
    expect(workspaceBaselineSource).toContain('"retired_at" IS NULL');
    expect(workspaceGuardSource).toContain("immutable outside an active key rotation");
    expect(workspaceMemberDetachmentSource).toContain("member_id = NULL");
    expect(workspaceMemberDetachmentSource).toContain("requested_by_member_id = NULL");
    expect(workspaceMemberDetachmentSource).toContain("cancel_requested_by_member_id = NULL");
    expect(workspaceMemberDetachmentSource).toContain("approved_by_member_id = NULL");
    expect(workspaceRetentionSource).toContain("Workspace evidence requires an exact retention purge");
    expect(workspaceLifecycleSource).toContain(
      'role: "owner" }, ["owner"]',
    );
    expect(workspaceLifecycleSource).toContain(
      "AND name = ${input.confirmation}",
    );
    expect(workspaceLifecycleSource).toContain(
      "SET lifecycle_state = 'deletion_pending'",
    );
    expect(workspaceLifecycleSource).toContain(
      "SET active_organization_id = NULL",
    );
    expect(workspaceAuthorizationSource).toContain(
      'authority.lifecycleState !== "active"',
    );
    expect(workspaceLifecycleRouteSource).toContain(
      'Object.keys(body).some((key) => !allowedKeys.includes(key))',
    );
    // Desktop schedules deletion only for the exact workspace name, compared and sent
    // untrimmed, and only owners are shown or rendered Backups & deletion.
    expect(workspaceAdminSource("lifecycle/useLifecycleController.ts")).toContain(
      "confirmation !== current.workspaceName",
    );
    expect(workspaceAdminSource("lifecycle/WorkspaceDeletionSection.tsx")).toContain(
      "confirmation === status.workspaceName",
    );
    expect(workspaceAdminRoutesSource).toContain(
      '"confirmation": exact_text(confirmation, 120, "deletion confirmation")?',
    );
    const exactText = workspaceAdminRoutesSource.slice(
      workspaceAdminRoutesSource.indexOf("fn exact_text("),
      workspaceAdminRoutesSource.indexOf("fn opaque_token("),
    );
    expect(exactText).toContain("Ok(value.to_string())");
    expect(exactText).not.toContain("trim");
    const sectionIds = (scope: Parameters<typeof workspaceAdminSectionsFor>[0]) =>
      workspaceAdminSectionsFor(scope).map((section) => section.id);
    expect(sectionIds({ canManage: true, isOwner: true })).toEqual([
      "workspace-members",
      "workspace-access",
      "workspace-providers",
      "workspace-lifecycle",
    ]);
    expect(sectionIds({ canManage: true, isOwner: false })).not.toContain("workspace-lifecycle");
    expect(sectionIds({ canManage: false, isOwner: false })).toEqual([]);
    expect(sectionIds(null)).toEqual([]);
    expect(workspaceAdminDialogSource).toContain(
      'active === "workspace-lifecycle" && scope.isOwner &&',
    );
    expect(sectionDialogSource).toContain(
      'aria-current={active === entry.id ? "page" : undefined}',
    );
    expect(desktopSettingsSource).toMatch(/entry\(\s*"safety",[\s\S]*?"dataSource",\s*\)/);
    expect(desktopSettingsSource).toContain('t("settings.selectConnection")');
    expect(workspaceSnapshotRestoreSource).toContain("readonlyDefault: true");
    expect(workspaceSnapshotRestoreSource).toContain("allowWrites: false");
  });
});
