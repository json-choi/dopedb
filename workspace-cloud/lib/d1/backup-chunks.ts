import "server-only";

import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { queryD1 } from "./database";

const CHUNK_BYTES = 524_288;
const PREFIX = "d1-chunks:v1:";
const digest = (value: string) => createHash("sha256").update(value, "ascii").digest("hex");

/** AES envelope text is ASCII; the manifest and every chunk commit atomically. */
export function backupEnvelopeStorage(ciphertext: string) {
  if (!/^[\x20-\x7e]+$/.test(ciphertext) || ciphertext.length > CHUNK_BYTES * 128) {
    throw new Error("Invalid encrypted Workspace backup size");
  }
  const chunks: string[] = [];
  if (ciphertext.length > CHUNK_BYTES) {
    for (let offset = 0; offset < ciphertext.length; offset += CHUNK_BYTES) {
      chunks.push(ciphertext.slice(offset, offset + CHUNK_BYTES));
    }
  }
  const value = chunks.length ? `${PREFIX}${ciphertext.length}:${chunks.length}:${digest(ciphertext)}` : ciphertext;
  return {
    value,
    statements(organizationId: string, backupId: string, scope: SQL): SQL[] {
      return [
        sql`DELETE FROM workspace_backup_chunk WHERE organization_id = ${organizationId} AND backup_id = ${backupId}
          AND manifest <> ${value} AND EXISTS (${scope})`,
        ...chunks.map((chunk, part) => sql`INSERT INTO workspace_backup_chunk (organization_id, backup_id, manifest, part, ciphertext)
          SELECT ${organizationId}, ${backupId}, ${value}, ${part}, ${chunk} FROM (${scope})`),
      ];
    },
  };
}

export async function readBackupEnvelope(organizationId: string, backupId: string, value: string) {
  if (!value.startsWith(PREFIX)) return value;
  const match = /^d1-chunks:v1:([1-9][0-9]*):([1-9][0-9]*):([a-f0-9]{64})$/.exec(value);
  if (!match || Number(match[1]) > CHUNK_BYTES * 128 || Number(match[2]) > 128) {
    throw new Error("Invalid encrypted Workspace backup manifest");
  }
  const chunks = await queryD1<{ part: number; ciphertext: string }>(sql`
    SELECT part, ciphertext FROM workspace_backup_chunk
    WHERE organization_id = ${organizationId} AND backup_id = ${backupId} AND manifest = ${value}
    ORDER BY part LIMIT 128`);
  if (chunks.length !== Number(match[2]) || chunks.some((chunk, part) => chunk.part !== part)) {
    throw new Error("Incomplete encrypted Workspace backup");
  }
  const ciphertext = chunks.map((chunk) => chunk.ciphertext).join("");
  if (ciphertext.length !== Number(match[1]) || digest(ciphertext) !== match[3]) {
    throw new Error("Encrypted Workspace backup integrity mismatch");
  }
  return ciphertext;
}
