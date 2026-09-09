import { verifyD1PermissionChanges } from "./d1-permission-scenarios.harness";
import { verifyD1Operations } from "./d1-operation-scenarios.harness";
import { verifyD1Retention } from "./d1-lifecycle-scenarios.harness";
import { verifyD1Backups } from "./d1-backup-scenarios.harness";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { createWorkspaceD1 } from "./d1/database";
import { workspaceProviderIntegration, workspaceProviderResource, workspaceProviderDiscoveryReceipt,
  workspaceProviderOperation } from "./d1/schema";
import { insertKnowledgeProject, appendKnowledgeEnvironment, deleteKnowledgeProject } from "./knowledge/project-store";
import { importProviderReceipt } from "./provider-import-store";
import { canonicalHash } from "./workspace-versioning";
import { recordProviderDiscoveryReceipt, revalidateProviderDiscoveryAuthority } from "./provider-integrations/discovery-receipts";
import { providerImportProjection } from "./providers/import-projection";
import { loadProviderLocalTarget } from "./provider-local-target";
import { verifyD1ManagedLeaseAuthority } from "./d1-managed-lease-scenarios.harness";
import { verifyD1IntegrationMutations } from "./d1-integration-scenarios.harness";
import { verifyD1ConnectionVersioning } from "./d1-versioning-scenarios.harness";
import { verifyD1WorkspaceRoutes } from "./d1-route-scenarios.harness";
import { loadProviderProvisioningTarget } from "./provider-provisioning-target";
import { verifyD1AnalysisArticles } from "./d1-analysis-scenarios.harness";

export async function verifyD1WorkspaceMutations(db: D1Database, identity: {
  workspaceId: string; memberId: string; userId: string; sessionId: string;
}) {
  const { workspaceId: organizationId, memberId: membershipId, userId, sessionId } = identity;
  const authority = { organizationId, membershipId, userId, sessionId, role: "owner" as const, capability: "manage" as const };
  await verifyD1Backups(db, userId, sessionId);
  await verifyD1Retention(db, userId, sessionId);
  await verifyD1Operations(db, authority);
  await verifyD1IntegrationMutations(db, authority);
  await verifyD1ConnectionVersioning(db, organizationId, authority);
  const inserted = await insertKnowledgeProject({ organizationId, authority, name: "Atomic project",
    environments: [{ name: "Development", riskClass: "development" }] });
  expect(inserted?.environments).toHaveLength(1);
  expect(await insertKnowledgeProject({ organizationId, authority, name: "Atomic project",
    environments: [{ name: "Development", riskClass: "development" }] })).toBeNull();
  const changes = await Promise.all(["Staging", "Production"].map((name) => appendKnowledgeEnvironment({
    organizationId, projectId: inserted!.id, expectedProjectRevision: 1, name,
    riskClass: name === "Production" ? "production" : "staging", authority,
  })));
  expect(changes.filter(Boolean)).toHaveLength(1);
  expect(changes.find(Boolean)?.revision).toBe(2);
  expect(await deleteKnowledgeProject({ organizationId, projectId: inserted!.id, expectedRevision: 1, authority })).toBe("stale");
  expect(await deleteKnowledgeProject({ organizationId, projectId: inserted!.id, expectedRevision: 2, authority })).toBe("deleted");
  expect(await appendKnowledgeEnvironment({ organizationId, projectId: inserted!.id, expectedProjectRevision: 3,
    name: "Late", riskClass: "test", authority })).toBeNull();

  const { orm } = createWorkspaceD1(db);
  const [integration] = await orm.insert(workspaceProviderIntegration).values({ organizationId, provider: "neon",
    displayName: "Import fixture", externalAccountId: randomUUID(), encryptedCredential: "fixture-envelope" }).returning();
  const resourceShape = { engine: "postgres", project: "fixture-project", branch: "fixture-branch",
    database: "fixture", databaseId: "1004", schemas: ["public"] };
  const resourceValues = { organizationId, provider: "neon", resource: resourceShape,
    redactedMetadata: { production: false }, capabilityManifest: { discover: true, importReadOnly: true, write: false, managedLease: true } };
  const [resource] = await orm.insert(workspaceProviderResource).values({ ...resourceValues,
    resourceFingerprint: canonicalHash(resourceShape) }).returning();
  const discovery = { organizationId, integrationId: integration.id, provider: "neon",
    integrationGeneration: integration.generation, memberId: membershipId, userId, sessionId, role: "owner",
    receiptId: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
    projection: providerImportProjection("neon", { ...resourceShape, branch: "discovered-branch" }, { production: false }) };
  const discoveries = await Promise.all(Array.from({ length: 4 }, () => recordProviderDiscoveryReceipt(discovery)));
  expect(discoveries.every((value) => value?.id === discovery.receiptId)).toBe(true);
  expect(await recordProviderDiscoveryReceipt({ ...discovery, expiresAt: new Date(Date.now() + 120_000) })).toBeNull();
  expect(await revalidateProviderDiscoveryAuthority(discovery)).toBe(true);
  const makeReceipt = async (resourceId = resource.id) => {
    const [receipt] = await orm.insert(workspaceProviderDiscoveryReceipt).values({ organizationId,
      resourceId, integrationId: integration.id, integrationGeneration: integration.generation,
      memberId: membershipId, userId, sessionId, expiresAt: new Date(Date.now() + 60_000) }).returning();
    return receipt.id;
  };
  const input = { organizationId, integrationId: integration.id, authority, receiptId: await makeReceipt(),
    idempotencyKey: randomUUID(), name: "Imported database", productionApproved: false };
  const imported = await Promise.all(Array.from({ length: 8 }, () => importProviderReceipt(input)));
  expect(imported.every((result) => result.kind === "imported")).toBe(true);
  const connectionIds = imported.map((result) => result.kind === "imported" ? result.connection.id : null);
  expect(new Set(connectionIds).size).toBe(1);
  const connectionId = connectionIds[0]!;
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_resource_version WHERE resource_id = ?")
    .bind(connectionId).first("count")).toBe(1);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_connection_grant WHERE connection_id = ?")
    .bind(connectionId).first("count")).toBe(1);
  const version = await db.prepare("SELECT payload, payload_hash FROM workspace_resource_version WHERE resource_id = ?")
    .bind(connectionId).first<{ payload: string; payload_hash: string }>();
  expect(canonicalHash(JSON.parse(version!.payload))).toBe(version!.payload_hash);
  await db.prepare("UPDATE workspace_connection SET credential_mode = 'member_local' WHERE id = ?").bind(connectionId).run();
  expect((await loadProviderLocalTarget({ organizationId, connectionId, authority }))?.target)
    .toEqual(resourceShape);
  await db.prepare("UPDATE workspace_connection SET name = 'Changed name' WHERE id = ?").bind(connectionId).run();
  expect(await loadProviderLocalTarget({ organizationId, connectionId, authority })).toBeNull();
  await db.prepare("UPDATE workspace_connection SET name = ?, credential_mode = 'managed' WHERE id = ?")
    .bind(input.name, connectionId).run();
  expect((await loadProviderProvisioningTarget({ organizationId, connectionId }))?.resource).toEqual(resourceShape);
  await verifyD1WorkspaceRoutes(db, { organizationId, connectionId, sessionId });
  await verifyD1AnalysisArticles(db, organizationId, connectionId, authority);
  await verifyD1ManagedLeaseAuthority(db, { organizationId, memberId: membershipId, userId, sessionId,
    role: "owner", connectionId, connectionRevision: 1, integrationId: integration.id,
    integrationGeneration: integration.generation, providerResourceId: resource.id,
    provider: "neon", connectionProvider: "neon", engine: "postgres", accessMode: "read", leaseId: randomUUID() });
  expect(await importProviderReceipt({ ...input, name: "Changed request" })).toEqual({ kind: "idempotency_conflict" });
  expect(await importProviderReceipt({ ...input, idempotencyKey: randomUUID(), receiptId: await makeReceipt() }))
    .toEqual({ kind: "resource_conflict" });
  await db.prepare("UPDATE workspace_provider_resource SET redacted_metadata = '{\"production\":true}' WHERE id = ?")
    .bind(resource.id).run();
  expect(await importProviderReceipt(input)).toEqual({ kind: "invalid_receipt" });
  await db.prepare("UPDATE workspace_provider_resource SET redacted_metadata = '{\"production\":false}' WHERE id = ?")
    .bind(resource.id).run();
  await db.prepare("UPDATE workspace_provider_integration SET generation = generation + 1 WHERE id = ?")
    .bind(integration.id).run();
  expect(await importProviderReceipt(input)).toEqual({ kind: "invalid_receipt" });
  await db.prepare("UPDATE workspace_provider_integration SET generation = ? WHERE id = ?")
    .bind(Number(integration.generation), integration.id).run();

  const [second] = await orm.insert(workspaceProviderResource).values({ ...resourceValues,
    resource: { ...resourceShape, branch: "second-branch" }, resourceFingerprint: canonicalHash("second-resource") }).returning();
  const secondInput = { ...input, receiptId: await makeReceipt(second.id), idempotencyKey: randomUUID() };
  await orm.insert(workspaceProviderOperation).values({ organizationId, integrationId: integration.id, provider: "neon",
    integrationGeneration: integration.generation, kind: "neon.branch.delete", state: "approved", idempotencyKey: randomUUID(),
    requestHash: canonicalHash("delete"), planHash: canonicalHash("delete-plan"), planExpiresAt: new Date(Date.now() + 60_000),
    risk: "standard", approvalPolicy: "single_admin", requestedByMemberId: membershipId,
    requestedByUserId: userId, requestedBySessionId: sessionId, requestedByRole: "owner",
    resourceScope: "fixture-project", sourceResourceId: "second-branch", targetName: "second-branch",
    ownershipMarker: "v1." + "a".repeat(43), redactedPlan: {} });
  expect(await importProviderReceipt(secondInput)).toEqual({ kind: "resource_conflict" });
  expect(await db.prepare("SELECT consumed_at FROM workspace_provider_discovery_receipt WHERE id = ?")
    .bind(secondInput.receiptId).first("consumed_at")).toBeNull();
  await db.prepare("DELETE FROM workspace_provider_operation WHERE integration_id = ?").bind(integration.id).run();
  // A late evidence failure must roll back receipt consumption, connection and grant.
  await db.exec("CREATE TRIGGER fixture_import_failure BEFORE INSERT ON workspace_resource_version BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  try {
    await expect(importProviderReceipt(secondInput)).rejects.toThrow();
    expect(await db.prepare("SELECT consumed_at FROM workspace_provider_discovery_receipt WHERE id = ?")
      .bind(secondInput.receiptId).first("consumed_at")).toBeNull();
    expect(await db.prepare("SELECT count(*) AS count FROM workspace_connection WHERE provider_resource_id = ?")
      .bind(second.id).first("count")).toBe(0);
  } finally {
    await db.exec("DROP TRIGGER fixture_import_failure");
  }
  await db.prepare("UPDATE member SET revocation_pending_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), membershipId).run();
  try {
    expect(await importProviderReceipt(secondInput)).toEqual({ kind: "invalid_receipt" });
    expect(await recordProviderDiscoveryReceipt(discovery)).toBeNull();
    expect(await revalidateProviderDiscoveryAuthority(discovery)).toBe(false);
    expect(await insertKnowledgeProject({ organizationId, authority, name: "Revoked project",
      environments: [{ name: "Development", riskClass: "development" }] })).toBeNull();
  } finally {
    await db.prepare("UPDATE member SET revocation_pending_at = NULL WHERE id = ?").bind(membershipId).run();
  }
  await verifyD1PermissionChanges(db, authority, connectionId);
}
