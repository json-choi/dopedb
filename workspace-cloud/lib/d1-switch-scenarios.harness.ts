import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { ProviderMutationAuthority } from "./provider-integrations/authority";
import { providerOperationOwnershipMarker } from "./provider-operation-marker";
import { recordProviderOperationPlan, decideProviderOperation } from "./provider-operation-plan";
import { claimProviderOperationExecution, markProviderOperationRemoteStarted } from "./provider-operation-execution";
import { completeNeonBranchSwitch } from "./provider-operation-switch";
import { canonicalHash, parseConnectionVersionPayload } from "./workspace-versioning";
import { commitConnectionCreate } from "./workspace-versioning-store";
import { claimRevocationGate } from "./revocation-gates";
import { providerImportProjection } from "./providers/import-projection";
import type { NeonBranchSwitchPlan } from "./providers/neon-branch-switch-plan";

export async function verifyD1BranchSwitch(db: D1Database, authority: ProviderMutationAuthority, integrationId: string) {
  const connectionId = randomUUID(); const sourceResourceId = randomUUID();
  const resource = { engine: "postgres", project: "fixture-project", branch: "fixture-source", databaseId: "1004", database: "fixture", schemas: ["public"] };
  const source = providerImportProjection("neon", resource, { production: false, writeAvailable: true });
  const target = providerImportProjection("neon", { ...resource, branch: "fixture-destination" }, { production: false, writeAvailable: true });
  const payload = parseConnectionVersionPayload({ name: "Switch fixture", engine: "postgres", provider: "neon", driverId: null,
    host: source.host, port: source.port, database: source.database, sslmode: source.sslmode,
    readonlyDefault: true, allowWrites: false, env: "development", schemaGroup: null, deleted: false }, { credentialMode: "managed" });
  expect(await commitConnectionCreate({ organizationId: authority.organizationId, connectionId, authority, input: payload })).not.toBeNull();
  await db.batch([
    db.prepare(`INSERT INTO workspace_provider_resource (id, organization_id, provider, resource_fingerprint, resource, redacted_metadata, capability_manifest)
      VALUES (?, ?, 'neon', ?, ?, ?, ?)`)
      .bind(sourceResourceId, authority.organizationId, source.fingerprint, JSON.stringify(source.resource), JSON.stringify(source.metadata), JSON.stringify(source.capabilities)),
    db.prepare(`UPDATE workspace_connection SET credential_mode = 'managed', provider_integration_id = ?, provider_resource_id = ?, provider_resource = ? WHERE id = ?`)
      .bind(integrationId, sourceResourceId, JSON.stringify(source.resource), connectionId),
  ]);
  const now = new Date(); const operationId = randomUUID();
  const branch = { currentState: "ready" as const, pendingState: null, stateChangedAt: now.toISOString(), updatedAt: now.toISOString(),
    default: false, protected: false, restrictedActions: [] };
  const plan: NeonBranchSwitchPlan = { version: 1, kind: "neon.branch.switch", operationId, integrationId, integrationGeneration: "1",
    issuedAt: now.toISOString(), expiresAt: new Date(now.valueOf() + 600_000).toISOString(),
    source: { ...branch, projectId: resource.project, branchId: resource.branch, name: "Source", connectionId,
      connectionName: payload.name, providerResourceId: sourceResourceId, databaseId: resource.databaseId, database: resource.database,
      schemas: ["public"], environment: "development", readonlyDefault: true, allowWrites: false, schemaGroup: null,
      contentRevision: 1, authorityRevision: 1, activeLeaseCount: 0 },
    target: { ...branch, projectId: resource.project, branchId: "fixture-destination", name: "Destination", databaseId: resource.databaseId,
      database: resource.database, endpointId: "fixture-destination-endpoint", databaseFingerprint: "a".repeat(64), resourceFingerprint: target.fingerprint,
      managedAccessOperationId: null, environment: "development" },
    impact: { activeLeaseCount: 0, closesExistingSessions: true, createsConnectionRevision: true, reintrospectionRequired: true },
    risk: "standard", approvalPolicy: "single_admin", warningCodes: [],
  };
  const planHash = canonicalHash(plan);
  const ownershipMarker = providerOperationOwnershipMarker({ organizationId: authority.organizationId, integrationId, integrationGeneration: 1n, operationId, planHash });
  const input = { authority, integrationId, integrationGeneration: 1n, operationId, kind: plan.kind, planHash, ownershipMarker, now };
  expect(await recordProviderOperationPlan({ ...input, plan, idempotencyKey: randomUUID(), requestHash: "e".repeat(64) })).not.toBeNull();
  expect(await decideProviderOperation({ ...input, decision: "approved" })).not.toBeNull();
  const claim = await claimProviderOperationExecution(input);
  expect(claim).not.toBeNull();
  expect((await markProviderOperationRemoteStarted({ ...input, claimId: claim!.claimId }))?.startedNow).toBe(true);
  const connectionClaim = await claimRevocationGate({ kind: "connection", organizationId: authority.organizationId, connectionId });
  expect(connectionClaim?.connectionRevision).toBe(2);
  const completion = { ...input, plan, claimId: claim!.claimId, connectionClaimId: connectionClaim!.claimId, targetProjection: target };
  expect(await completeNeonBranchSwitch({ ...completion, connectionClaimId: randomUUID() })).toBeNull();
  await db.exec(`CREATE TRIGGER fixture_switch_failure BEFORE INSERT ON workspace_resource_version WHEN NEW.resource_id = '${connectionId}' BEGIN SELECT RAISE(ABORT, 'fixture switch rollback'); END;`);
  await expect(completeNeonBranchSwitch(completion)).rejects.toThrow();
  expect(await db.prepare("SELECT provider_resource_id FROM workspace_connection WHERE id = ?").bind(connectionId).first("provider_resource_id")).toBe(sourceResourceId);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_provider_resource WHERE organization_id = ? AND resource_fingerprint = ?")
    .bind(authority.organizationId, target.fingerprint).first("count")).toBe(0);
  await db.exec("DROP TRIGGER fixture_switch_failure;");
  const completed = await Promise.all(Array.from({ length: 4 }, () => completeNeonBranchSwitch(completion)));
  expect(completed.filter(Boolean)).toEqual([{ operationId, connectionId, contentRevision: 2, authorityRevision: 2, targetBranchId: "fixture-destination" }]);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_resource_version WHERE resource_id = ?").bind(connectionId).first("count")).toBe(2);
}
