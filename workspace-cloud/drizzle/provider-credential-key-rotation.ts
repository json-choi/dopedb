// Historical PostgreSQL recovery utility; never imported by the D1 Worker.
// Operator-only, transactional re-encryption. This module exposes no HTTP route,
// keys, or plaintext. It deliberately refuses operation-signing-key migration.
import { createHash } from "node:crypto";
import type postgres from "postgres";

import {
  openProviderEnvelope,
  providerCredentialKeyId,
  sealProviderEnvelope,
} from "../lib/provider-credential-envelope";

type CredentialRow = { id: string; encrypted_credential: string; record: unknown };
type RotationInput = {
  currentKey: Buffer;
  nextKey: Buffer;
  expectedSnapshot?: string;
  apply?: boolean;
};

const MAX_ROWS = 1_000;
const MAX_CIPHERTEXT_BYTES = 4 * 1024 * 1024;

function reencrypt(rows: CredentialRow[], kind: string, input: RotationInput) {
  return rows.map((row) => {
    const context = `dopedb:${kind}:${row.id}`;
    const plaintext = openProviderEnvelope(input.currentKey, row.encrypted_credential, context);
    const encrypted = sealProviderEnvelope(input.nextKey, plaintext, context);
    if (openProviderEnvelope(input.nextKey, encrypted, context) !== plaintext) {
      throw new Error("Credential rotation round-trip verification failed");
    }
    return { id: row.id, encrypted };
  });
}

export async function rotateProviderCredentialKey(sql: postgres.Sql, input: RotationInput) {
  const currentKeyId = providerCredentialKeyId(input.currentKey);
  const nextKeyId = providerCredentialKeyId(input.nextKey);
  if (input.apply && currentKeyId === nextKeyId) throw new Error("Credential rotation requires a different key");
  if (input.apply && !/^[a-f0-9]{64}$/.test(input.expectedSnapshot ?? "")) {
    throw new Error("Credential rotation requires an exact preflight snapshot");
  }

  return sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SET LOCAL statement_timeout = '20s'`;
    // Lock all writers, including old deployment URLs and concurrent provider
    // callbacks. Keep the same order for preflight and commit.
    await tx`LOCK TABLE workspace_control.workspace_provider_integration,
      workspace_control.provider_setup_session,
      workspace_control.workspace_provider_operation IN SHARE ROW EXCLUSIVE MODE`;
    const [state] = await tx`
      SELECT
        (SELECT count(*)::integer FROM workspace_control.workspace_provider_operation) AS operations,
        (SELECT count(*)::integer FROM workspace_control.provider_setup_session
          WHERE expires_at > now() AND consumed_at IS NULL) AS live_setups,
        (SELECT count(*)::integer FROM workspace_control.workspace_provider_integration
          WHERE provider NOT IN ('gcpCloudSql', 'neon')) AS other_providers,
        (SELECT count(*)::integer FROM workspace_control.workspace_provider_integration
          WHERE refresh_phase <> 'idle' OR disconnect_phase <> 'idle'
            OR revocation_pending_at IS NOT NULL) AS pending_changes
    `;
    if (state.operations !== 0) throw new Error("Operation ownership signatures require a separate migration");
    if (state.live_setups !== 0) throw new Error("Wait for active provider setup sessions to finish or expire");
    // Existing operation signatures (including remote Neon annotations) cannot
    // be replaced by re-encrypting provider credentials.
    if (state.other_providers !== 0) throw new Error("Provider rotation requires a reviewed provider-specific migration");
    if (state.pending_changes !== 0) throw new Error("Wait for pending provider credential changes to finish");
    const integrations = await tx<CredentialRow[]>`
      SELECT id, encrypted_credential, to_jsonb(t) AS record
      FROM workspace_control.workspace_provider_integration t ORDER BY id LIMIT ${MAX_ROWS + 1}
    `;
    const setups = await tx<CredentialRow[]>`
      SELECT id, encrypted_credential, to_jsonb(t) AS record
      FROM workspace_control.provider_setup_session t ORDER BY id LIMIT ${MAX_ROWS + 1}
    `;
    const rows = [...integrations, ...setups];
    if (rows.length > MAX_ROWS || rows.reduce((size, row) => (
      size + Buffer.byteLength(row.encrypted_credential)
    ), 0) > MAX_CIPHERTEXT_BYTES) throw new Error("Credential rotation exceeds its reviewed batch budget");
    const snapshot = createHash("sha256").update(JSON.stringify({ integrations, setups })).digest("hex");
    if (input.apply && input.expectedSnapshot !== snapshot) {
      throw new Error("Credentials changed after preflight; run preflight again");
    }
    const nextIntegrations = reencrypt(integrations, "provider-integration", input);
    const nextSetups = reencrypt(setups, "provider-setup", input);

    let operationsResumeAt: string | null = null;
    if (input.apply) {
      // Temporary cutover fences are operator-owned, not migration-journal
      // entries. Retain them until every old runtime has been retired.
      await tx`ALTER TABLE workspace_control.workspace_provider_integration
        DROP CONSTRAINT IF EXISTS provider_credential_rotation_fence`;
      await tx`ALTER TABLE workspace_control.provider_setup_session
        DROP CONSTRAINT IF EXISTS provider_credential_rotation_fence`;
      for (const row of nextIntegrations) {
        await tx`UPDATE workspace_control.workspace_provider_integration
          SET encrypted_credential = ${row.encrypted} WHERE id = ${row.id}::uuid`;
      }
      for (const row of nextSetups) {
        await tx`UPDATE workspace_control.provider_setup_session
          SET encrypted_credential = ${row.encrypted} WHERE id = ${row.id}::uuid`;
      }
      // The only interpolation is the fixed-format SHA-256 identifier computed
      // above. No key, input SQL, or credential enters DDL.
      for (const table of ["workspace_provider_integration", "provider_setup_session"]) {
        await tx.unsafe(`ALTER TABLE workspace_control.${table}
          ADD CONSTRAINT provider_credential_rotation_fence
          CHECK (starts_with(encrypted_credential, 'v2.${nextKeyId}.'))`);
      }
      // Old requests can already hold a decrypted Neon credential in memory.
      // Their operation signatures must not arrive after the table lock releases.
      // Six minutes exceeds the reviewed source's 60-second operation handlers
      // and 300-second integration/setup handlers. New operations resume after
      // this drain; old runtimes then cannot open the fenced v2 credentials.
      const [clock] = await tx`SELECT now() + interval '6 minutes' AS resumes_at`;
      operationsResumeAt = new Date(clock.resumes_at).toISOString();
      await tx`ALTER TABLE workspace_control.workspace_provider_operation
        DROP CONSTRAINT IF EXISTS provider_operation_rotation_fence`;
      await tx.unsafe(`ALTER TABLE workspace_control.workspace_provider_operation
        ADD CONSTRAINT provider_operation_rotation_fence
        CHECK (created_at >= '${operationsResumeAt}'::timestamptz)`);
      const verified = await tx<{ id: string; encrypted_credential: string; kind: string; record: unknown }[]>`
        SELECT id, encrypted_credential, 'provider-integration' AS kind, to_jsonb(t) - 'encrypted_credential' AS record
          FROM workspace_control.workspace_provider_integration t
        UNION ALL
        SELECT id, encrypted_credential, 'provider-setup' AS kind, to_jsonb(t) - 'encrypted_credential' AS record
          FROM workspace_control.provider_setup_session t
      `;
      if (verified.length !== rows.length) throw new Error("Credential row count changed during rotation");
      for (const row of verified) {
        const original = (row.kind === "provider-integration" ? integrations : setups)
          .find((candidate) => candidate.id === row.id);
        if (!original) throw new Error("Unexpected credential row after rotation");
        const originalRecord = { ...(original.record as Record<string, unknown>) };
        delete originalRecord.encrypted_credential;
        if (JSON.stringify(originalRecord) !== JSON.stringify(row.record)) {
          throw new Error("Credential metadata changed during rotation");
        }
        const context = `dopedb:${row.kind}:${row.id}`;
        if (openProviderEnvelope(input.nextKey, row.encrypted_credential, context)
          !== openProviderEnvelope(input.currentKey, original.encrypted_credential, context)) {
          throw new Error("Persisted credential verification failed");
        }
      }
    }
    return {
      applied: input.apply === true,
      snapshot,
      currentKeyId,
      nextKeyId,
      integrations: integrations.length,
      setups: setups.length,
      operations: 0,
      verified: rows.length,
      metadataPreserved: true,
      operationsResumeAt,
    };
  });
}
