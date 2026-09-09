// Extend the isolated PostgreSQL journey with lossless key rotation and old
// deployment write rejection. No production URL or real secret enters this test.
import { randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";

import { rotateProviderCredentialKey } from "../../drizzle/provider-credential-key-rotation";
import { openProviderEnvelope, sealProviderEnvelope } from "../provider-credential-envelope";
import { sealEnvelope } from "../secret-envelope-core";
import type { OpenProviderImportPostgresHarness } from "./fixture";

export async function runCredentialKeyRotationScenarios({ sql }: OpenProviderImportPostgresHarness) {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const integrationId = randomUUID();
  const setupId = randomUUID();
  const neonId = randomUUID();
  const currentKey = randomBytes(32);
  const nextKey = randomBytes(32);
  const plaintext = JSON.stringify({ credential: "rotation-fixture-secret", unicode: "한글" });
  const integrationContext = `dopedb:provider-integration:${integrationId}`;
  const oldEnvelope = sealEnvelope(currentKey, plaintext, integrationContext);
  const setupEnvelope = sealEnvelope(currentKey, plaintext, `dopedb:provider-setup:${setupId}`);
  const tagged = sealProviderEnvelope(nextKey, plaintext, integrationContext);
  expect(() => openProviderEnvelope(currentKey, tagged, integrationContext)).toThrow();
  expect(() => openProviderEnvelope(nextKey, tagged, `dopedb:provider-integration:${setupId}`)).toThrow();
  expect(() => openProviderEnvelope(nextKey, tagged.split('.').slice(2).join('.'), integrationContext)).toThrow();
  try {
    await sql`INSERT INTO workspace_control.organization (id, name, slug)
      VALUES (${organizationId}, 'Credential rotation fixture', ${organizationId})`;
    await sql`INSERT INTO workspace_control."user" (id, name, email, email_verified)
      VALUES (${userId}, 'Credential rotation fixture', ${`${userId}@dopedb.invalid`}, true)`;
    await sql`INSERT INTO workspace_control.workspace_provider_integration
      (id, organization_id, provider, external_account_id, display_name, encrypted_credential, local_verification_target)
      VALUES (${integrationId}::uuid, ${organizationId}, 'gcpCloudSql', 'rotation-fixture', 'Rotation fixture', ${oldEnvelope},
        '{"kind":"gcpCloudSql","projectId":"dopedb-fixture","instanceId":"fixture"}'::jsonb)`;
    await sql`INSERT INTO workspace_control.provider_setup_session
      (id, organization_id, user_id, provider, encrypted_credential, account_label, expires_at)
      VALUES (${setupId}::uuid, ${organizationId}, ${userId}, 'gcpCloudSql', ${setupEnvelope}, 'Rotation fixture', now() - interval '1 hour')`;
    await sql`INSERT INTO workspace_control.workspace_provider_integration
      (id, organization_id, provider, external_account_id, display_name, encrypted_credential)
      VALUES (${neonId}::uuid, ${organizationId}, 'neon', 'rotation-neon', 'Neon rotation fixture',
        ${sealEnvelope(currentKey, plaintext, `dopedb:provider-integration:${neonId}`)})`;
    const preflight = await rotateProviderCredentialKey(sql, { currentKey, nextKey });
    expect(preflight).toMatchObject({ applied: false, integrations: 2, setups: 1, verified: 3 });
    await expect(rotateProviderCredentialKey(sql, {
      currentKey, nextKey, apply: true, expectedSnapshot: '0'.repeat(64),
    })).rejects.toThrow('changed after preflight');
    await sql`UPDATE workspace_control.provider_setup_session SET expires_at = now() + interval '5 minutes' WHERE id = ${setupId}::uuid`;
    await expect(rotateProviderCredentialKey(sql, { currentKey, nextKey })).rejects.toThrow('active provider setup');
    await sql`UPDATE workspace_control.provider_setup_session SET expires_at = now() - interval '1 hour', encrypted_credential = 'broken' WHERE id = ${setupId}::uuid`;
    await expect(rotateProviderCredentialKey(sql, { currentKey, nextKey })).rejects.toThrow();
    const [untouched] = await sql`SELECT encrypted_credential FROM workspace_control.workspace_provider_integration WHERE id = ${integrationId}::uuid`;
    expect(untouched.encrypted_credential).toBe(oldEnvelope);
    await sql`UPDATE workspace_control.provider_setup_session SET encrypted_credential = ${setupEnvelope} WHERE id = ${setupId}::uuid`;
    const ready = await rotateProviderCredentialKey(sql, { currentKey, nextKey });
    const receipt = await rotateProviderCredentialKey(sql, {
      currentKey, nextKey, apply: true, expectedSnapshot: ready.snapshot,
    });
    expect(receipt).toMatchObject({ applied: true, verified: 3, metadataPreserved: true });
    expect(Date.parse(receipt.operationsResumeAt!)).toBeGreaterThan(Date.now() + 300_000);
    const [stored] = await sql`SELECT encrypted_credential FROM workspace_control.workspace_provider_integration WHERE id = ${integrationId}::uuid`;
    expect(openProviderEnvelope(nextKey, stored.encrypted_credential, integrationContext)).toBe(plaintext);
    await expect(sql`UPDATE workspace_control.workspace_provider_integration SET encrypted_credential = ${oldEnvelope} WHERE id = ${integrationId}::uuid`)
      .rejects.toMatchObject({ code: '23514' });
    const oldTagged = sealProviderEnvelope(currentKey, plaintext, integrationContext);
    await expect(sql`UPDATE workspace_control.workspace_provider_integration SET encrypted_credential = ${oldTagged} WHERE id = ${integrationId}::uuid`)
      .rejects.toMatchObject({ code: '23514' });
    await expect(rotateProviderCredentialKey(sql, {
      currentKey, nextKey, apply: true, expectedSnapshot: ready.snapshot,
    })).rejects.toThrow('changed after preflight');
    expect(await rotateProviderCredentialKey(sql, { currentKey: nextKey, nextKey }))
      .toMatchObject({ applied: false, verified: 3 });
  } finally {
    await sql`ALTER TABLE workspace_control.workspace_provider_integration DROP CONSTRAINT IF EXISTS provider_credential_rotation_fence`;
    await sql`ALTER TABLE workspace_control.provider_setup_session DROP CONSTRAINT IF EXISTS provider_credential_rotation_fence`;
    await sql`ALTER TABLE workspace_control.workspace_provider_operation DROP CONSTRAINT IF EXISTS provider_operation_rotation_fence`;
    await sql`DELETE FROM workspace_control.organization WHERE id = ${organizationId}`;
    await sql`DELETE FROM workspace_control."user" WHERE id = ${userId}`;
    currentKey.fill(0);
    nextKey.fill(0);
  }
}
