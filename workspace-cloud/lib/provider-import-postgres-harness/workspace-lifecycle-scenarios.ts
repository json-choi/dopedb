import { randomUUID } from "node:crypto";

import { expect, vi } from "vitest";

import type { ProviderImportSupportAssertions } from "./assertions";
import type { ProviderImportPostgresHarness } from "./fixture";

export async function runWorkspaceLifecycleScenarios(
  fixture: ProviderImportPostgresHarness,
  support: ProviderImportSupportAssertions,
) {
  const {
    kmsMemberId,
    kmsOrganizationId,
    kmsSessionId,
    kmsUserId,
    sql,
  } = fixture;
  const { kmsKeyName } = support;

  vi.doMock("../workspace-kms", () => ({
    wrapWorkspaceDataKey: async (wrappedInput: {
      configuration: { keyName: string };
      version: number;
      plaintextKey: Buffer;
    }) => ({
      kmsKeyVersion: `${wrappedInput.configuration.keyName}/cryptoKeyVersions/${wrappedInput.version}`,
      wrappedKey: Buffer.from(wrappedInput.plaintextKey).toString("base64"),
    }),
    unwrapWorkspaceDataKey: async (wrappedInput: { wrappedKey: string }) =>
      Buffer.from(wrappedInput.wrappedKey, "base64"),
    workspaceKmsAccessToken: async () => "unused-harness-access-token",
    workspaceKmsConfiguration: () => { throw new Error("unused harness configuration"); },
    workspaceKmsOidcToken: () => { throw new Error("unused harness OIDC token"); },
  }));
  const [dataKeyStore, dataKeyRotation, workspaceBackup, workspaceLifecycle] = await Promise.all([
    import("../workspace-data-key"),
    import("../workspace-data-key-rotation"),
    import("../workspace-backup"),
    import("../workspace-lifecycle"),
  ]);
  const kmsSession = {
    configuration: {
      keyName: kmsKeyName,
      workloadIdentityAudience: "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/dopedb-workspace/providers/dopedb-workspace",
      serviceAccountEmail: "workspace-kms@dopedb-harness.iam.gserviceaccount.com",
    },
    accessToken: "harness-access-token",
  };
  const kmsAuthority = {
    sessionId: kmsSessionId,
    userId: kmsUserId,
    membershipId: kmsMemberId,
  };
  const firstDataKey = await dataKeyStore.ensureActiveWorkspaceDataKey({
    organizationId: kmsOrganizationId,
    actorUserId: kmsUserId,
    kms: kmsSession,
  });
  expect(firstDataKey.version).toBe(1);
  const backupId = randomUUID();
  const kmsSnapshot = {
    version: 1 as const,
    workspace: {
      organizationId: kmsOrganizationId,
      lifecycleState: "active",
      residencyRegion: null,
      revision: 1,
    },
    connections: [],
  };
  const firstCiphertext = await dataKeyStore.withWorkspaceDataKey(
    kmsSession,
    firstDataKey,
    (key) => workspaceBackup.sealWorkspaceMetadataBackupWithDataKey(
      key,
      firstDataKey,
      backupId,
      kmsSnapshot,
    ),
  );
  await sql`
    INSERT INTO "workspace_control"."workspace_metadata_backup"
      ("id", "organization_id", "source_revision", "key_reference", "key_version",
       "data_key_id", "ciphertext", "snapshot_hash", "created_by_user_id")
    VALUES (${backupId}::uuid, ${kmsOrganizationId}, 1,
      ${workspaceBackup.WORKSPACE_DATA_KEY_REFERENCE},
      ${workspaceBackup.workspaceDataKeyVersion(firstDataKey.version)},
      ${firstDataKey.id}::uuid, ${firstCiphertext},
      ${workspaceBackup.snapshotHash(kmsSnapshot)}, ${kmsUserId})
  `;
  await expect(sql`
    UPDATE "workspace_control"."workspace_metadata_backup"
    SET "ciphertext" = 'unauthorized-rewrite'
    WHERE "id" = ${backupId}::uuid
  `).rejects.toThrow(/immutable outside an active key rotation/);
  const rotationRequestId = randomUUID();
  const startedRotation = await dataKeyRotation.beginOrClaimWorkspaceDataKeyRotation({
    organizationId: kmsOrganizationId,
    authority: kmsAuthority,
    kms: kmsSession,
    idempotencyKey: rotationRequestId,
  });
  expect(startedRotation.replayed).toBe(false);
  expect(startedRotation.claim).not.toBeNull();
  if (!startedRotation.claim) throw new Error("KMS harness rotation was not claimed");
  const advancedRotation = await dataKeyRotation.advanceWorkspaceDataKeyRotation({
    organizationId: kmsOrganizationId,
    authority: kmsAuthority,
    kms: kmsSession,
    claim: startedRotation.claim,
  });
  expect(advancedRotation).toEqual({
    status: "completed",
    processedBackups: 1,
    remaining: 0,
  });
  const rotationStatus = await dataKeyRotation.workspaceDataKeyRotationStatus(
    kmsOrganizationId,
  );
  expect(rotationStatus).toMatchObject({
    activeVersion: 2,
    backupCount: 1,
    rotation: {
      status: "completed",
      fromVersion: 1,
      toVersion: 2,
      processedBackups: 1,
      remainingBackups: 0,
    },
  });
  const replayedRotation = await dataKeyRotation.beginOrClaimWorkspaceDataKeyRotation({
    organizationId: kmsOrganizationId,
    authority: kmsAuthority,
    kms: kmsSession,
    idempotencyKey: rotationRequestId,
  });
  expect(replayedRotation).toEqual({ claim: null, busy: false, replayed: true });
  const rotatedBackup = await sql<{
    ciphertext: string;
    dataKeyId: string;
    keyVersion: string;
    rotationId: string;
  }[]>`
    SELECT "ciphertext" AS "ciphertext", "data_key_id"::text AS "dataKeyId",
      "key_version" AS "keyVersion",
      "reencrypted_by_rotation_id"::text AS "rotationId"
    FROM "workspace_control"."workspace_metadata_backup"
    WHERE "id" = ${backupId}::uuid AND "organization_id" = ${kmsOrganizationId}
  `;
  expect(rotatedBackup[0]).toMatchObject({
    dataKeyId: expect.any(String),
    keyVersion: "v2",
    rotationId: rotationStatus.rotation?.id,
  });
  const secondDataKey = await dataKeyStore.workspaceDataKeyById(
    kmsOrganizationId,
    rotatedBackup[0]!.dataKeyId,
  );
  if (!secondDataKey) throw new Error("KMS harness target key is missing");
  const reopenedSnapshot = await workspaceBackup.openWorkspaceMetadataBackupWithKms(
    kmsSession,
    {
      workspaceId: kmsOrganizationId,
      backupId,
      ciphertext: rotatedBackup[0]!.ciphertext,
      binding: {
        dataKeyId: secondDataKey.id,
        keyReference: workspaceBackup.WORKSPACE_DATA_KEY_REFERENCE,
        keyVersion: workspaceBackup.workspaceDataKeyVersion(secondDataKey.version),
      },
    },
  );
  expect(reopenedSnapshot).toEqual(kmsSnapshot);
  const retiredKeyState = await sql<{ wrappedKey: string | null; destroyed: boolean }[]>`
    SELECT "wrapped_key" AS "wrappedKey", "destroyed_at" IS NOT NULL AS "destroyed"
    FROM "workspace_control"."workspace_data_key"
    WHERE "id" = ${firstDataKey.id}::uuid
      AND "organization_id" = ${kmsOrganizationId}
  `;
  expect(retiredKeyState[0]).toEqual({ wrappedKey: null, destroyed: true });
  await expect(sql`
    UPDATE "workspace_control"."workspace_metadata_backup"
    SET "ciphertext" = 'post-rotation-rewrite'
    WHERE "id" = ${backupId}::uuid
  `).rejects.toThrow(/immutable outside an active key rotation/);

  await sql`
    UPDATE "workspace_control"."workspace_metadata_backup"
    SET "deleted_at" = now() - interval '8 days',
        "purge_after" = now() - interval '1 day'
    WHERE "id" = ${backupId}::uuid
      AND "organization_id" = ${kmsOrganizationId}
  `;
  const backupRetention = await workspaceLifecycle.cleanupWorkspaceRetention({
    backupLimit: 8,
    workspaceLimit: 1,
  });
  expect(backupRetention).toMatchObject({ backupsPurged: 1, workspacesPurged: 0 });
  const deletedBackup = await sql<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "workspace_control"."workspace_metadata_backup"
      WHERE "id" = ${backupId}::uuid
    ) AS "present"
  `;
  expect(deletedBackup[0]?.present).toBe(false);

  const deletionRequestId = randomUUID();
  expect(await workspaceLifecycle.scheduleWorkspaceDeletion({
    organizationId: kmsOrganizationId,
    authority: kmsAuthority,
    requestId: deletionRequestId,
    confirmation: "wrong workspace name",
  })).toBeNull();
  expect(await workspaceLifecycle.scheduleWorkspaceDeletion({
    organizationId: kmsOrganizationId,
    authority: kmsAuthority,
    requestId: deletionRequestId,
    confirmation: "KMS Harness",
  })).toBe("scheduled");
  expect(await workspaceLifecycle.scheduleWorkspaceDeletion({
    organizationId: kmsOrganizationId,
    authority: kmsAuthority,
    requestId: deletionRequestId,
    confirmation: "KMS Harness",
  })).toBe("replayed");
  expect(await workspaceLifecycle.workspaceLifecycleStatus(kmsOrganizationId)).toMatchObject({
    lifecycleState: "deletion_pending",
    deletionReceiptId: deletionRequestId,
    backupCount: 0,
    blockers: { memberRevocations: 1 },
  });
  expect(await workspaceLifecycle.cancelWorkspaceDeletion({
    organizationId: kmsOrganizationId,
    authority: kmsAuthority,
    requestId: deletionRequestId,
  })).toBe("cancelled");
  expect(await workspaceLifecycle.cancelWorkspaceDeletion({
    organizationId: kmsOrganizationId,
    authority: kmsAuthority,
    requestId: deletionRequestId,
  })).toBe("replayed");
  expect(await workspaceLifecycle.workspaceLifecycleStatus(kmsOrganizationId)).toMatchObject({
    lifecycleState: "active",
    deletionReceiptId: null,
    blockers: { memberRevocations: 0 },
  });

  const finalDeletionRequestId = randomUUID();
  expect(await workspaceLifecycle.scheduleWorkspaceDeletion({
    organizationId: kmsOrganizationId,
    authority: kmsAuthority,
    requestId: finalDeletionRequestId,
    confirmation: "KMS Harness",
  })).toBe("scheduled");
  await sql`
    UPDATE "workspace_control"."workspace_deletion_receipt"
    SET "requested_at" = now() - interval '8 days',
        "purge_after" = now() - interval '1 day'
    WHERE "id" = ${finalDeletionRequestId}::uuid
      AND "organization_id" = ${kmsOrganizationId}
  `;
  await sql`
    UPDATE "workspace_control"."workspace_profile"
    SET "deletion_requested_at" = now() - interval '8 days',
        "purge_after" = now() - interval '1 day'
    WHERE "organization_id" = ${kmsOrganizationId}
      AND "deletion_receipt_id" = ${finalDeletionRequestId}::uuid
  `;
  await sql`
    UPDATE "workspace_control"."member" member
    SET "revocation_pending_at" = profile."deletion_requested_at"
    FROM "workspace_control"."workspace_profile" profile
    WHERE member."organization_id" = ${kmsOrganizationId}
      AND profile."organization_id" = member."organization_id"
  `;
  const workspaceRetention = await workspaceLifecycle.cleanupWorkspaceRetention({
    backupLimit: 8,
    workspaceLimit: 1,
  });
  expect(workspaceRetention).toEqual({
    backupsPurged: 0,
    workspacesPurged: 1,
    workspacesDeferred: 0,
  });
  const purgedWorkspace = await sql<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "workspace_control"."organization"
      WHERE "id" = ${kmsOrganizationId}
    ) AS "present"
  `;
  expect(purgedWorkspace[0]?.present).toBe(false);
  const deletionReceipt = await sql<{ status: string; actor: string | null }[]>`
    SELECT "status" AS "status", "requested_by_user_id" AS "actor"
    FROM "workspace_control"."workspace_deletion_receipt"
    WHERE "id" = ${finalDeletionRequestId}::uuid
  `;
  expect(deletionReceipt[0]).toEqual({ status: "purged", actor: kmsUserId });

}
