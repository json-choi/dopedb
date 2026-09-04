import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { vi } from "vitest";
import * as workspaceSchema from "../schema";

type ProviderHarnessCleanupTargets = {
  organizationId: string;
  otherOrganizationId: string;
  kmsOrganizationId: string;
  userId: string;
  removableUserId: string;
  kmsUserId: string;
};

export async function openProviderImportPostgresHarness(
  dedicatedDatabaseUrl: string,
  dedicatedDatabaseSentinel: string,
) {
  const sql = postgres(dedicatedDatabaseUrl, {
    max: 8,
    onnotice: () => undefined,
    prepare: false,
  });
  const sentinel = await sql<{ confirmed: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM "provider_harness"."isolated_database_sentinel"
      WHERE "marker" = ${dedicatedDatabaseSentinel}
    ) AS "confirmed"
  `;
  if (sentinel[0]?.confirmed !== true) {
    await sql.end();
    throw new Error("Dedicated PostgreSQL harness sentinel was not confirmed");
  }
  const migrationState = await sql<{ ready: boolean }[]>`
    SELECT (
      to_regclass('workspace_control.workspace_provider_discovery_receipt') IS NOT NULL
      AND to_regclass('workspace_control.workspace_provider_import_request') IS NOT NULL
      AND to_regclass('workspace_control.workspace_provider_resource') IS NOT NULL
      AND to_regclass('workspace_control.workspace_resource_conflict_resolution') IS NOT NULL
      AND to_regclass('workspace_control.workspace_data_key') IS NOT NULL
      AND to_regclass('workspace_control.workspace_data_key_rotation') IS NOT NULL
      AND to_regclass('workspace_control.workspace_deletion_receipt') IS NOT NULL
      AND to_regclass('workspace_control.workspace_sync_head') IS NOT NULL
      AND to_regclass('workspace_control.workspace_sync_event') IS NOT NULL
      AND to_regclass('workspace_control.knowledge_project') IS NOT NULL
      AND to_regclass('workspace_control.knowledge_project_environment') IS NOT NULL
      AND to_regclass('workspace_control.workspace_analysis_article') IS NOT NULL
      AND to_regclass('workspace_control.workspace_analysis_article_revision') IS NOT NULL
      AND to_regclass('workspace_control.workspace_analysis_article_run') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'workspace_control'
          AND table_name = 'workspace_provider_integration'
          AND column_name = 'local_verification_target'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'workspace_control'
          AND table_name = 'workspace_analysis_runner'
          AND column_name = 'runner_capability_generation'
          AND is_nullable = 'NO'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'workspace_control'
          AND table_name = 'workspace_credential_lease'
          AND column_name = 'provider_audit_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'workspace_control'
          AND table_name = 'workspace_metadata_backup'
          AND column_name = 'reencrypted_by_rotation_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'workspace_control'
          AND table_name = 'workspace_metadata_backup'
          AND column_name = 'purge_after'
      )
      AND to_regprocedure('workspace_control.purge_due_workspace(text,uuid)') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'workspace_control.workspace_metadata_backup'::regclass
          AND tgname = 'workspace_metadata_backup_payload_immutable'
          AND NOT tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'workspace_control.workspace_audit_event'::regclass
          AND tgname = 'workspace_audit_append_sync_event'
          AND NOT tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'workspace_control.workspace_analysis_article_revision'::regclass
          AND tgname = 'workspace_analysis_article_revision_immutable_update'
          AND NOT tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'workspace_control.workspace_provider_operation'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%neon.branch.switch%'
      )
    ) AS "ready"
  `;
  if (migrationState[0]?.ready !== true) {
    await sql.end();
    throw new Error("Dedicated PostgreSQL harness database is not pre-migrated");
  }

  const neonSql = {
    query: async (
      query: string,
      parameters: Parameters<typeof sql.unsafe>[1] = [],
    ) => (
      sql.unsafe(query, parameters)
    ),
    transaction: async (factory: (tx: unknown) => Promise<unknown>[]) => (
      sql.begin(async (tx) => {
        const queries = factory(tx);
        const results: unknown[] = [];
        for (const query of queries) results.push(await query);
        return results;
      })
    ),
  };
  const postgresDb = drizzle(sql, { schema: workspaceSchema });
  const harnessDb = new Proxy(postgresDb, {
    get(target, property, receiver) {
      if (property === "execute") {
        return async (query: Parameters<typeof postgresDb.execute>[0]) => ({
          rows: await postgresDb.execute(query),
        });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  vi.doMock("../db", () => ({ db: harnessDb, neonSql }));
  const authState = {
    fixture: null as Record<string, unknown> | null,
    bearer: "",
    cookie: "",
  };
  const getSession = vi.fn(async ({ headers }: { headers: Headers }) => (
    authState.fixture
    && (
      headers.get("authorization") === authState.bearer
      || headers.get("cookie") === authState.cookie
    )
      ? authState.fixture
      : null
  ));
  vi.doMock("../auth", () => ({ auth: { api: { getSession } } }));

  let cleanupTargets: ProviderHarnessCleanupTargets | null = null;
  let cleanupPromise: Promise<void> | null = null;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      if (cleanupTargets) {
        await sql`
          DELETE FROM "workspace_control"."organization"
          WHERE "id" IN (
            ${cleanupTargets.organizationId},
            ${cleanupTargets.otherOrganizationId},
            ${cleanupTargets.kmsOrganizationId}
          )
        `.catch(() => undefined);
        await sql`
          DELETE FROM "workspace_control"."user"
          WHERE "id" IN (
            ${cleanupTargets.userId},
            ${cleanupTargets.removableUserId},
            ${cleanupTargets.kmsUserId}
          )
        `.catch(() => undefined);
      }
      await sql.end({ timeout: 5 });
      vi.doUnmock("../db");
      vi.doUnmock("../workspace-kms");
    })();
    return cleanupPromise;
  };

  return {
    sql,
    authState,
    registerCleanupTargets(targets: ProviderHarnessCleanupTargets) {
      cleanupTargets = targets;
    },
    cleanup,
  };
}

export type OpenProviderImportPostgresHarness =
  Awaited<ReturnType<typeof openProviderImportPostgresHarness>>;

export async function seedProviderImportPostgresHarness(
  database: OpenProviderImportPostgresHarness,
) {
  const { sql } = database;
  const [{ importProviderReceipt }, projectStore, { revocationGateLockKey }] = await Promise.all([
    import("../provider-import-store"),
    import("../knowledge/project-store"),
    import("../revocation-gates"),
  ]);

  const suffix = randomUUID();
  const organizationId = randomUUID();
  const otherOrganizationId = `harness-other-${suffix}`;
  const userId = `harness-user-${suffix}`;
  const memberId = `harness-member-${suffix}`;
  const sessionId = `harness-session-${suffix}`;
  const removableUserId = `harness-removable-user-${suffix}`;
  const removableMemberId = `harness-removable-member-${suffix}`;
  const integrationId = randomUUID();
  const resourceId = randomUUID();
  const receiptId = randomUUID();
  const providerSecret = `never-copy-this-${suffix}`;
  const kmsOrganizationId = randomUUID();
  const kmsUserId = `harness-kms-user-${suffix}`;
  const kmsMemberId = `harness-kms-member-${suffix}`;
  const kmsSessionId = `harness-kms-session-${suffix}`;
  const authority = {
    sessionId,
    userId,
    membershipId: memberId,
    role: "admin" as const,
  };
  const knowledgeAuthority = {
    ...authority,
    organizationId,
    capability: "manage" as const,
  };
  const insertReceipt = async (id: string, generation = 1) => {
    await sql`
      INSERT INTO "workspace_control"."workspace_provider_discovery_receipt"
        ("id", "organization_id", "resource_id", "integration_id",
         "integration_generation", "member_id", "user_id", "session_id", "expires_at")
      VALUES
        (${id}::uuid, ${organizationId}, ${resourceId}::uuid, ${integrationId}::uuid,
         ${generation}, ${memberId}, ${userId}, ${sessionId}, now() + interval '5 minutes')
    `;
  };

  database.registerCleanupTargets({
    organizationId,
    otherOrganizationId,
    kmsOrganizationId,
    userId,
    removableUserId,
    kmsUserId,
  });

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO "workspace_control"."organization" ("id", "name", "slug")
      VALUES (${organizationId}, 'Harness', ${`harness-${suffix}`}),
             (${otherOrganizationId}, 'Other', ${`harness-other-${suffix}`}),
             (${kmsOrganizationId}, 'KMS Harness', ${`harness-kms-${suffix}`})
    `;
    await tx`
      INSERT INTO "workspace_control"."user"
        ("id", "name", "email", "email_verified")
      VALUES (${userId}, 'Harness', ${`harness-${suffix}@invalid.test`}, TRUE),
             (${removableUserId}, 'Removable Harness',
              ${`harness-removable-${suffix}@invalid.test`}, TRUE),
             (${kmsUserId}, 'KMS Harness', ${`harness-kms-${suffix}@invalid.test`}, TRUE)
    `;
    await tx`
      INSERT INTO "workspace_control"."member"
        ("id", "organization_id", "user_id", "role")
      VALUES (${memberId}, ${organizationId}, ${userId}, 'admin'),
             (${removableMemberId}, ${organizationId}, ${removableUserId}, 'viewer'),
             (${kmsMemberId}, ${kmsOrganizationId}, ${kmsUserId}, 'owner')
    `;
    await tx`
      INSERT INTO "workspace_control"."session"
        ("id", "expires_at", "token", "user_id")
      VALUES (${sessionId}, now() + interval '10 minutes',
              ${`harness-token-${suffix}`}, ${userId}),
             (${kmsSessionId}, now() + interval '10 minutes',
              ${`harness-kms-token-${suffix}`}, ${kmsUserId})
    `;
    await tx`
      INSERT INTO "workspace_control"."workspace_profile"
        ("organization_id", "encryption_key_ref")
      VALUES (${organizationId}, ${`pending://${organizationId}`}),
             (${otherOrganizationId}, ${`pending://${otherOrganizationId}`})
    `;
    await tx`
      INSERT INTO "workspace_control"."workspace_profile"
        ("organization_id", "encryption_key_ref")
      VALUES (${kmsOrganizationId}, ${`pending://${kmsOrganizationId}`})
    `;
    await tx`
      INSERT INTO "workspace_control"."workspace_provider_integration"
        ("id", "organization_id", "provider", "status", "external_account_id",
         "display_name", "encrypted_credential", "generation")
      VALUES (${integrationId}::uuid, ${organizationId}, 'neon', 'active',
              ${`harness-account-${suffix}`}, 'Harness Neon', ${providerSecret}, 1)
    `;
    await tx`
      INSERT INTO "workspace_control"."workspace_provider_resource"
        ("id", "organization_id", "provider", "resource_fingerprint",
         "resource", "redacted_metadata", "capability_manifest")
      VALUES (
        ${resourceId}::uuid, ${organizationId}, 'neon', ${"f".repeat(64)},
        ${JSON.stringify({
          project: "harness-project",
          branch: "harness-branch",
          database: "app",
          engine: "postgres",
          schemas: ["public"],
        })}::jsonb,
        ${JSON.stringify({ production: false })}::jsonb,
        ${JSON.stringify({
          discover: true,
          importReadOnly: true,
          managedLease: true,
          write: false,
        })}::jsonb
      )
    `;
  });

  return {
    ...database,
    importProviderReceipt,
    projectStore,
    revocationGateLockKey,
    suffix,
    organizationId,
    otherOrganizationId,
    userId,
    memberId,
    sessionId,
    removableUserId,
    removableMemberId,
    integrationId,
    resourceId,
    receiptId,
    providerSecret,
    kmsOrganizationId,
    kmsUserId,
    kmsMemberId,
    kmsSessionId,
    authority,
    knowledgeAuthority,
    insertReceipt,
  };
}

export type ProviderImportPostgresHarness =
  Awaited<ReturnType<typeof seedProviderImportPostgresHarness>>;
