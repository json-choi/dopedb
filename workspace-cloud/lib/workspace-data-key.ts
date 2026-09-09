// Durable per-workspace DEK versions. Plaintext key material is request-local,
// passed only to a callback, and zeroized before this module returns.
import "server-only";

import { and, desc, eq, isNull, max, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { db } from "./db";
import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
import { workspaceDataKey } from "./schema";
import {
  unwrapWorkspaceDataKey,
  workspaceKmsAccessToken,
  workspaceKmsConfiguration,
  workspaceKmsOidcToken,
  wrapWorkspaceDataKey,
} from "./workspace-kms";
import { WorkspaceKmsError, type WorkspaceKmsConfiguration } from "./workspace-kms-core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CREATE_ATTEMPTS = 3;

export type WorkspaceDataKeyRow = typeof workspaceDataKey.$inferSelect;
export type WorkspaceKmsSession = {
  configuration: WorkspaceKmsConfiguration;
  accessToken: string;
};

type ReturnedDataKeyRow = {
  id: unknown;
  organizationId: unknown;
  version: unknown;
  keyReference: unknown;
  kmsKeyVersion: unknown;
  wrappedKey: unknown;
  createdByUserId: unknown;
  createdAt: unknown;
  retiredAt: unknown;
  destroyedAt: unknown;
};

function dateOrNull(value: unknown) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function returnedDataKey(row: ReturnedDataKeyRow): WorkspaceDataKeyRow | null {
  const version = typeof row.version === "number"
    ? row.version
    : typeof row.version === "string" ? Number(row.version) : NaN;
  const createdAt = dateOrNull(row.createdAt);
  const retiredAt = dateOrNull(row.retiredAt);
  const destroyedAt = dateOrNull(row.destroyedAt);
  if (
    typeof row.id !== "string"
    || !UUID.test(row.id)
    || typeof row.organizationId !== "string"
    || !UUID.test(row.organizationId)
    || !Number.isSafeInteger(version)
    || version < 1
    || typeof row.keyReference !== "string"
    || typeof row.kmsKeyVersion !== "string"
    || (row.wrappedKey !== null && typeof row.wrappedKey !== "string")
    || (row.createdByUserId !== null && typeof row.createdByUserId !== "string")
    || !createdAt
    || retiredAt === undefined
    || destroyedAt === undefined
  ) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    version,
    keyReference: row.keyReference,
    kmsKeyVersion: row.kmsKeyVersion,
    wrappedKey: row.wrappedKey as string | null,
    createdByUserId: row.createdByUserId as string | null,
    createdAt,
    retiredAt,
    destroyedAt,
  };
}

function assertUsableDataKey(
  row: WorkspaceDataKeyRow,
  configuration: WorkspaceKmsConfiguration,
) {
  if (
    row.keyReference !== configuration.keyName
    || !row.kmsKeyVersion.startsWith(`${configuration.keyName}/cryptoKeyVersions/`)
    || !row.wrappedKey
    || row.destroyedAt
  ) throw new WorkspaceKmsError("integrity", 409);
  return row;
}

export async function createWorkspaceKmsSession(request: Request): Promise<WorkspaceKmsSession> {
  const configuration = workspaceKmsConfiguration();
  const accessToken = await workspaceKmsAccessToken(
    configuration,
    await workspaceKmsOidcToken(),
  );
  return { configuration, accessToken };
}

export async function activeWorkspaceDataKey(organizationId: string) {
  if (!UUID.test(organizationId)) throw new WorkspaceKmsError("integrity", 409);
  return db.query.workspaceDataKey.findFirst({
    where: and(
      eq(workspaceDataKey.organizationId, organizationId),
      isNull(workspaceDataKey.retiredAt),
      isNull(workspaceDataKey.destroyedAt),
    ),
    orderBy: [desc(workspaceDataKey.version)],
  });
}

export async function ensureActiveWorkspaceDataKey(input: {
  organizationId: string;
  actorUserId: string;
  kms: WorkspaceKmsSession;
}) {
  if (!UUID.test(input.organizationId)) throw new WorkspaceKmsError("integrity", 409);
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const existing = await activeWorkspaceDataKey(input.organizationId);
    if (existing) return assertUsableDataKey(existing, input.kms.configuration);

    const [maximum] = await db.select({ value: max(workspaceDataKey.version) })
      .from(workspaceDataKey)
      .where(eq(workspaceDataKey.organizationId, input.organizationId));
    const version = Number(maximum.value ?? 0) + 1;
    if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
      throw new WorkspaceKmsError("integrity", 409);
    }
    const dataKeyId = crypto.randomUUID();
    const plaintextKey = randomBytes(32);
    try {
      const wrapped = await wrapWorkspaceDataKey({
        configuration: input.kms.configuration,
        accessToken: input.kms.accessToken,
        workspaceId: input.organizationId,
        dataKeyId,
        version,
        plaintextKey,
      });
      const result = await atomicD1({
        scope: sql`WITH existing AS (SELECT id FROM workspace_data_key WHERE organization_id = ${input.organizationId}
            AND retired_at IS NULL AND destroyed_at IS NULL)
          SELECT json_object('id', COALESCE((SELECT id FROM existing), ${dataKeyId}),
            'created', NOT EXISTS (SELECT 1 FROM existing)) AS payload
          WHERE EXISTS (SELECT 1 FROM existing) OR (
            EXISTS (SELECT 1 FROM workspace_profile WHERE organization_id = ${input.organizationId} AND lifecycle_state = 'active')
            AND ${version} = COALESCE((SELECT max(version) + 1 FROM workspace_data_key WHERE organization_id = ${input.organizationId}), 1))`,
        statements: (scope) => [
          sql`INSERT INTO workspace_data_key (id, organization_id, version, key_reference, kms_key_version, wrapped_key, created_by_user_id)
            SELECT ${dataKeyId}, ${input.organizationId}, ${version}, ${input.kms.configuration.keyName},
              ${wrapped.kmsKeyVersion}, ${wrapped.wrappedKey}, ${input.actorUserId} FROM (${scope}) WHERE payload ->> 'created' = 1`,
          sql`UPDATE workspace_profile SET encryption_key_ref = ${`workspace-data-key:${dataKeyId}`}, updated_at = ${utcNow}
            WHERE organization_id = ${input.organizationId} AND EXISTS (SELECT 1 FROM (${scope}) WHERE payload ->> 'created' = 1)`,
          sql`SELECT key.id, key.organization_id AS organizationId, key.version, key.key_reference AS keyReference,
              key.kms_key_version AS kmsKeyVersion, key.wrapped_key AS wrappedKey, key.created_by_user_id AS createdByUserId,
              key.created_at AS createdAt, key.retired_at AS retiredAt, key.destroyed_at AS destroyedAt
            FROM workspace_data_key key CROSS JOIN (${scope}) WHERE key.id = payload ->> 'id'`,
        ],
      });
      const raw = result.rows[2][0] as ReturnedDataKeyRow | undefined;
      const row = raw && returnedDataKey(raw);
      if (row) return assertUsableDataKey(row, input.kms.configuration);
    } finally {
      plaintextKey.fill(0);
    }
  }
  throw new WorkspaceKmsError("unavailable", 503);
}

export async function workspaceDataKeyById(organizationId: string, dataKeyId: string) {
  if (!UUID.test(organizationId) || !UUID.test(dataKeyId)) {
    throw new WorkspaceKmsError("integrity", 409);
  }
  return db.query.workspaceDataKey.findFirst({
    where: and(
      eq(workspaceDataKey.organizationId, organizationId),
      eq(workspaceDataKey.id, dataKeyId),
    ),
  });
}

export async function unwrapStoredWorkspaceDataKey(
  kms: WorkspaceKmsSession,
  row: WorkspaceDataKeyRow,
) {
  const usable = assertUsableDataKey(row, kms.configuration);
  return unwrapWorkspaceDataKey({
    configuration: kms.configuration,
    accessToken: kms.accessToken,
    workspaceId: usable.organizationId,
    dataKeyId: usable.id,
    version: usable.version,
    wrappedKey: usable.wrappedKey!,
  });
}

export async function withWorkspaceDataKey<T>(
  kms: WorkspaceKmsSession,
  row: WorkspaceDataKeyRow,
  operation: (key: Buffer) => Promise<T> | T,
): Promise<T> {
  const plaintextKey = await unwrapStoredWorkspaceDataKey(kms, row);
  try {
    return await operation(plaintextKey);
  } finally {
    plaintextKey.fill(0);
  }
}
