import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import type { AuthorityProviderScenarioResult } from "./authority-provider-scenarios";
import type { ProviderImportPostgresHarness } from "./fixture";

export async function runSyncScenarios(
  fixture: ProviderImportPostgresHarness,
  provider: AuthorityProviderScenarioResult,
) {
  const {
    importProviderReceipt,
    insertReceipt,
    integrationId,
    organizationId,
    otherOrganizationId,
    sql,
    suffix,
    userId,
  } = fixture;
  const { importInput: input } = provider;

  const syncJournal = await sql<{
    head: number;
    events: number;
    audits: number;
    firstSequence: number;
    lastSequence: number;
    payloadColumns: number;
  }[]>`
    SELECT
      head."last_sequence"::int AS "head",
      (SELECT count(*)::int FROM "workspace_control"."workspace_sync_event" event
       WHERE event."organization_id" = ${organizationId}) AS "events",
      (SELECT count(*)::int FROM "workspace_control"."workspace_audit_event" audit
       WHERE audit."organization_id" = ${organizationId}) AS "audits",
      (SELECT min(event."sequence")::int
       FROM "workspace_control"."workspace_sync_event" event
       WHERE event."organization_id" = ${organizationId}) AS "firstSequence",
      (SELECT max(event."sequence")::int
       FROM "workspace_control"."workspace_sync_event" event
       WHERE event."organization_id" = ${organizationId}) AS "lastSequence",
      (SELECT count(*)::int FROM information_schema.columns
       WHERE table_schema = 'workspace_control'
         AND table_name = 'workspace_sync_event'
         AND column_name ~ '(payload|summary|resource_id|actor|credential|result)')
         AS "payloadColumns"
    FROM "workspace_control"."workspace_sync_head" head
    WHERE head."organization_id" = ${organizationId}
  `;
  expect(syncJournal[0]?.head).toBeGreaterThan(0);
  expect(syncJournal[0]).toMatchObject({
    events: syncJournal[0]?.head,
    audits: syncJournal[0]?.head,
    firstSequence: 1,
    lastSequence: syncJournal[0]?.head,
    payloadColumns: 0,
  });
  const headBeforeRollback = syncJournal[0]?.head ?? 0;
  await sql`
    INSERT INTO "workspace_control"."workspace_audit_event"
      ("organization_id", "actor_user_id", "action", "resource_type",
       "resource_id", "redacted_summary", "request_id")
    VALUES
      (${organizationId}, ${userId}, 'credential.lease.issue', 'connection',
       NULL, '{}'::jsonb, ${randomUUID()}::uuid),
      (${organizationId}, ${userId}, 'workspace.backup.create', 'workspace_backup',
       NULL, '{}'::jsonb, ${randomUUID()}::uuid),
      (${organizationId}, ${userId}, 'workspace.data_key.rotation.complete', 'workspace',
       NULL, '{}'::jsonb, ${randomUUID()}::uuid)
  `;
  const headAfterLeaseAudit = await sql<{ head: number }[]>`
    SELECT "last_sequence"::int AS "head"
    FROM "workspace_control"."workspace_sync_head"
    WHERE "organization_id" = ${organizationId}
  `;
  expect(headAfterLeaseAudit[0]?.head).toBe(headBeforeRollback);
  await expect(sql.begin(async (tx) => {
    await tx`
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      VALUES (${organizationId}, ${userId}, 'analysis_article.rollback_probe', 'analysis_article',
              NULL, '{}'::jsonb, ${randomUUID()}::uuid)
    `;
    throw new Error("rollback sync probe");
  })).rejects.toThrow("rollback sync probe");
  const headAfterRollback = await sql<{ head: number }[]>`
    SELECT "last_sequence"::int AS "head"
    FROM "workspace_control"."workspace_sync_head"
    WHERE "organization_id" = ${organizationId}
  `;
  expect(headAfterRollback[0]?.head).toBe(headBeforeRollback);

  await Promise.all([
    sql`
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      VALUES (${organizationId}, ${userId}, 'connection.grant.revoke', 'connection',
              NULL, '{}'::jsonb, ${randomUUID()}::uuid)
    `,
    sql`
      INSERT INTO "workspace_control"."workspace_audit_event"
        ("organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      VALUES (${organizationId}, ${userId}, 'analysis_article.delete', 'analysis_article',
              NULL, '{}'::jsonb, ${randomUUID()}::uuid)
    `,
  ]);
  const concurrentSync = await sql<{
    sequence: number;
    resourceType: string;
    tombstone: boolean;
  }[]>`
    SELECT "sequence"::int AS "sequence", "resource_type" AS "resourceType",
      "tombstone" AS "tombstone"
    FROM "workspace_control"."workspace_sync_event"
    WHERE "organization_id" = ${organizationId}
      AND "sequence" > ${headBeforeRollback}
    ORDER BY "sequence"
  `;
  expect(concurrentSync.map((event) => event.sequence)).toEqual([
    headBeforeRollback + 1,
    headBeforeRollback + 2,
  ]);
  expect(new Set(concurrentSync.map((event) => event.resourceType))).toEqual(
    new Set(["connection", "analysis_article"]),
  );
  expect(concurrentSync.every((event) => event.tombstone)).toBe(true);
  const [workspaceAudit] = await sql<{ id: string }[]>`
    SELECT "id"::text AS "id"
    FROM "workspace_control"."workspace_audit_event"
    WHERE "organization_id" = ${organizationId}
    ORDER BY "created_at" DESC, "id" DESC
    LIMIT 1
  `;
  if (!workspaceAudit) throw new Error("Workspace sync audit fixture is missing");
  await expect(sql.begin(async (tx) => {
    // Temporarily remove the trigger-created row so the tenant FK, rather
    // than the one-event-per-audit uniqueness guard, owns this rejection.
    // The failed transaction rolls the removal back with the probe.
    await tx`
      DELETE FROM "workspace_control"."workspace_sync_event"
      WHERE "audit_event_id" = ${workspaceAudit.id}::uuid
    `;
    await tx`
      INSERT INTO "workspace_control"."workspace_sync_event"
        ("organization_id", "sequence", "audit_event_id", "resource_type",
         "operation", "tombstone")
      VALUES (${otherOrganizationId}, 1, ${workspaceAudit.id}::uuid,
              'connection', 'connection.cross_tenant_probe', FALSE)
    `;
  })).rejects.toThrow(/workspace_sync_event_org_audit_fk/);

  const secondKeyReceipt = randomUUID();
  await insertReceipt(secondKeyReceipt);
  await expect(importProviderReceipt({
    ...input,
    receiptId: secondKeyReceipt,
    idempotencyKey: `second-key-${suffix}`,
  })).resolves.toEqual({ kind: "resource_conflict" });

  const staleReceipt = randomUUID();
  await insertReceipt(staleReceipt);
  await sql`
    UPDATE "workspace_control"."workspace_provider_integration"
    SET "generation" = 2 WHERE "id" = ${integrationId}::uuid
  `;
  await expect(importProviderReceipt({
    ...input,
    receiptId: staleReceipt,
    idempotencyKey: `stale-${suffix}`,
  })).resolves.toEqual({ kind: "invalid_receipt" });

  const crossTenantReceipt = randomUUID();
  await insertReceipt(crossTenantReceipt, 2);
  await expect(importProviderReceipt({
    ...input,
    organizationId: otherOrganizationId,
    receiptId: crossTenantReceipt,
    idempotencyKey: `cross-tenant-${suffix}`,
  })).resolves.toEqual({ kind: "invalid_receipt" });

}
