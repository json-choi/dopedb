import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { matches, safeRelativePath } from "./d1/schema/patterns";
import { atomicD1 } from "./d1/atomic";
import { createWorkspaceD1 } from "./d1/database";
import { user, workspaceProviderIntegration, knowledgeGithubInstallation, knowledgeSource } from "./d1/schema";
import { consumeD1Budget } from "./d1/rate-limits";
import { verifyD1WorkspaceMutations } from "./d1-workspace-scenarios.harness";
import { verifyDesktopAuthorization, verifyDesktopAuthorizationRoutes } from "./desktop-authorization-scenarios";

const fixtureBinding = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { WORKSPACE_DB: fixtureBinding.value } }),
}));

// On failure, re-throws with the stage name and elapsed time in the message
// (original error kept as `cause`) so a slow-runner timeout or assertion
// failure names exactly which phase (Miniflare boot, migrations, or which
// assertion group) it hit instead of surfacing only a bare "Test timed out"
// (issue #194). No console output on the success path: workspace-cloud/lib
// is server code and `scripts/check-workspace-server-logs.mjs` forbids
// console.* there outside the one allowed sink.
async function withStage<T>(name: string, run: () => Promise<T>): Promise<T> {
  const label = `[d1-storage.harness:${name}]`;
  const startedAt = performance.now();
  try {
    const result = await run();
    return result;
  } catch (error) {
    const elapsed = (performance.now() - startedAt).toFixed(1);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed after ${elapsed}ms: ${message}`, { cause: error });
  }
}

let runtime: Miniflare;
let db: Awaited<ReturnType<InstanceType<typeof Miniflare>["getD1Database"]>>;

beforeAll(async () => {
  await withStage("miniflare-boot", async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } };',
      compatibilityDate: "2026-09-08",
      d1Databases: ["DB"],
    }));
    db = await runtime.getD1Database("DB");
    fixtureBinding.value = db;
  });

  const applyMigration = async (name: string) => {
    const source = await readFile(new URL(`../d1-migrations/${name}`, import.meta.url), "utf8");
    const statements = source.includes("--> statement-breakpoint")
      ? source.split("--> statement-breakpoint")
      : source.split(/(?=CREATE TRIGGER )/);
    for (const statement of statements) {
      const text = statement.replace(/^\s*--.*$/gm, "").trim();
      if (text) await db.exec(text.replace(/\r?\n/g, " "));
    }
  };
  await withStage("migrations", async () => {
    for (const name of ["0000_workspace_baseline.sql", "0001_workspace_guards.sql", "0002_storage_types.sql", "0003_atomic_scope.sql", "0004_member_evidence_detachment.sql", "0005_backup_chunks.sql", "0006_retention_purge.sql", "0007_unusual_lionheart.sql", "0008_remove_device_authorization.sql", "0009_bored_lady_ursula.sql", "0010_direct_shared_database.sql", "0011_mongo_template_options.sql"]) {
      await applyMigration(name);
    }
  });

  // Pre-kind Project environments (free names, risk classes, a duplicated kind with a
  // binding on the folded row) must migrate to the fixed kind list without losing the binding.
  await withStage("environment-kind-migration", async () => {
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const connectionId = randomUUID();
    const [productionId, duplicateProductionId, customId] = ["1", "2", "3"].map((suffix) => `00000000-0000-4000-8000-00000000000${suffix}`);
    await db.prepare("INSERT INTO organization (id, name, slug) VALUES (?, 'Kind migration', 'kind-migration')").bind(organizationId).run();
    await db.prepare("INSERT INTO knowledge_project (id, organization_id, name) VALUES (?, ?, 'Legacy')").bind(projectId, organizationId).run();
    const insertEnvironment = db.prepare("INSERT INTO knowledge_project_environment (id, organization_id, project_id, name, production, risk_class, revision) VALUES (?, ?, ?, ?, ?, ?, ?)");
    await insertEnvironment.bind(productionId, organizationId, projectId, "live", 0, "production", 1).run();
    await insertEnvironment.bind(duplicateProductionId, organizationId, projectId, "prod-eu", 1, "custom", 4).run();
    await insertEnvironment.bind(customId, organizationId, projectId, "main", 0, "custom", 1).run();
    await db.prepare("INSERT INTO workspace_connection (id, organization_id, name, engine, host, port, database_name, sslmode) VALUES (?, ?, 'Legacy', 'postgres', 'db.invalid', 5432, 'app', 'require')")
      .bind(connectionId, organizationId).run();
    await db.prepare("INSERT INTO knowledge_environment_connection (organization_id, project_environment_id, environment_revision, connection_id, connection_revision, role, alias) VALUES (?, ?, 4, ?, 1, 'primary', 'legacy')")
      .bind(organizationId, duplicateProductionId, connectionId).run();

    await applyMigration("0012_environment_kind.sql");

    const environments = await db.prepare("SELECT id, kind, name, production, risk_class, revision FROM knowledge_project_environment WHERE project_id = ? ORDER BY id")
      .bind(projectId).all();
    expect(environments.results).toEqual([
      { id: productionId, kind: "production", name: "Production", production: 1, risk_class: "production", revision: 1 },
      { id: customId, kind: "development", name: "Development", production: 0, risk_class: "development", revision: 1 },
    ]);
    // The binding on the folded row follows the surviving production environment and its revision.
    expect(await db.prepare("SELECT project_environment_id || '/' || environment_revision AS bound FROM knowledge_environment_connection WHERE connection_id = ?")
      .bind(connectionId).first("bound")).toBe(`${productionId}/1`);
    expect(await db.prepare("SELECT revision FROM knowledge_project WHERE id = ?").bind(projectId).first("revision")).toBe(2);
    expect(await db.prepare("SELECT count(*) AS count FROM workspace_audit_event WHERE organization_id = ? AND action = 'knowledge.environment.normalize'")
      .bind(organizationId).first("count")).toBe(3);
    // One environment per kind, and a kind outside the list, are database-enforced.
    await expect(insertEnvironment.bind(randomUUID(), organizationId, projectId, "again", 0, "production", 1).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE knowledge_project_environment SET kind = 'custom' WHERE id = ?").bind(customId).run()).rejects.toThrow();
  });

  // Team connections open to the team by default for every credential method. The migration only
  // redefines the team-read triggers (no table is rebuilt), so existing grants, direct endpoints,
  // principals, revocations, and versions must be exactly as they were, and a plain member-local
  // connection must now materialize team grants too.
  await withStage("team-connection-default-read-migration", async () => {
    const { commitConnectionCreate } = await import("./workspace-versioning-store");
    const { parseConnectionVersionPayload } = await import("./workspace-versioning");
    const organizationId = randomUUID();
    const ownerUser = randomUUID(); const ownerMember = randomUUID(); const sessionId = randomUUID();
    const analystUser = randomUUID(); const analystMember = randomUUID();
    await db.batch([
      db.prepare("INSERT INTO organization (id, name, slug) VALUES (?, 'Default read', ?)").bind(organizationId, `default-read-${organizationId}`),
      db.prepare("INSERT INTO workspace_profile (organization_id, encryption_key_ref) VALUES (?, 'fixture')").bind(organizationId),
      db.prepare("INSERT INTO user (id, name, email) VALUES (?, 'Owner', ?)").bind(ownerUser, `${ownerUser}@invalid.test`),
      db.prepare("INSERT INTO user (id, name, email) VALUES (?, 'Analyst', ?)").bind(analystUser, `${analystUser}@invalid.test`),
      db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'owner')").bind(ownerMember, organizationId, ownerUser),
      db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'analyst')").bind(analystMember, organizationId, analystUser),
      db.prepare("INSERT INTO session (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)")
        .bind(sessionId, randomUUID(), ownerUser, new Date(Date.now() + 60_000).toISOString()),
    ]);
    const authority = { sessionId, userId: ownerUser, membershipId: ownerMember, role: "owner" };
    const template = (name: string) => parseConnectionVersionPayload({ name, engine: "postgres", provider: "generic",
      driverId: null, host: "migrate.invalid", port: 5432, database: "app", sslmode: "verify-full",
      readonlyDefault: true, allowWrites: false, env: null, schemaGroup: null, deleted: false }, { credentialMode: "member_local" });
    const plainId = randomUUID(); const directId = randomUUID();
    expect(await commitConnectionCreate({ organizationId, connectionId: plainId, authority, input: template("Plain") })).not.toBeNull();
    expect(await commitConnectionCreate({ organizationId, connectionId: directId, authority, input: template("Direct"),
      direct: { scope: ["public"], writeCeiling: true } })).not.toBeNull();
    // Before the migration neither connection reaches the analyst through team read.
    await db.prepare("UPDATE workspace_connection SET team_read_enabled = 1 WHERE id = ?").bind(plainId).run();
    const analystGrants = (id: string) => db.prepare("SELECT count(*) AS count FROM workspace_connection_grant WHERE connection_id = ? AND member_id = ?")
      .bind(id, analystMember).first("count");
    expect(await analystGrants(plainId)).toBe(0);
    await db.prepare("UPDATE workspace_connection SET team_read_enabled = 0 WHERE id = ?").bind(plainId).run();
    await db.prepare("INSERT INTO workspace_connection_grant (organization_id, connection_id, member_id, capability) VALUES (?, ?, ?, 'use')")
      .bind(organizationId, directId, analystMember).run();
    await db.prepare(`INSERT INTO workspace_direct_principal (organization_id, connection_id, member_id, user_id, principal_name, marker, verifier_kind, verifier)
      VALUES (?, ?, ?, ?, 'dopedb_0123456789abcdef0123', ?, 'scram-sha-256', ?)`)
      .bind(organizationId, directId, analystMember, analystUser, "A".repeat(43),
        "SCRAM-SHA-256$4096:Y0ea1poJCyWCd+yPum+ZQQ==$h7BOWJYfmpnYU9QEagtbeT58Pku9IfWsqPsXwgzbHYs=:s+rNM0M7MbUlI1EDLJs+ei56p3ONXezfDdbGJoCFPAY=").run();
    await db.prepare("INSERT INTO workspace_direct_revocation (organization_id, connection_id, member_id, kind, target_level) VALUES (?, ?, ?, 'grant_lowered', 'read')")
      .bind(organizationId, directId, analystMember).run();
    const tables = ["workspace_connection", "workspace_connection_grant", "workspace_direct_endpoint", "workspace_direct_principal",
      "workspace_direct_revocation", "workspace_resource_version", "workspace_audit_event"];
    const counts = async () => Promise.all(tables.map(async (table) => db
      .prepare(`SELECT count(*) AS count FROM ${table} WHERE organization_id = ?`).bind(organizationId).first<number>("count")));
    const before = await counts();
    expect(before.every((count) => (count ?? 0) > 0)).toBe(true);

    await applyMigration("0013_team_connection_default_read.sql");

    expect(await counts()).toEqual(before);
    // The CHECK stays: a member-local template still delegates no write authority.
    await expect(db.prepare("UPDATE workspace_connection SET allow_writes = 1 WHERE id = ?").bind(plainId).run()).rejects.toThrow();
    // Team read now materializes grants on a plain member-local connection, for members present and joining later.
    // The team-read route (kept for Desktops that predate the default) works for them as well.
    const { setWorkspaceTeamRead } = await import("./workspace-team-read-store");
    expect(await setWorkspaceTeamRead({ organizationId, connectionId: plainId, authority, enabled: true })).toBe(true);
    expect(await analystGrants(plainId)).toBe(1);
    const lateUser = randomUUID(); const lateMember = randomUUID();
    await db.batch([
      db.prepare("INSERT INTO user (id, name, email) VALUES (?, 'Late', ?)").bind(lateUser, `${lateUser}@invalid.test`),
      db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'viewer')").bind(lateMember, organizationId, lateUser),
    ]);
    expect(await db.prepare("SELECT capability || '/' || origin AS grant FROM workspace_connection_grant WHERE connection_id = ? AND member_id = ?")
      .bind(plainId, lateMember).first("grant")).toBe("view/team");
    // The explicit direct-database grant keeps its level.
    expect(await db.prepare("SELECT capability FROM workspace_connection_grant WHERE connection_id = ? AND member_id = ?")
      .bind(directId, analystMember).first("capability")).toBe("use");
  });
});

afterAll(async () => {
  fixtureBinding.value = null;
  await runtime?.dispose();
});

describe("Workspace D1 safety", () => {
  it("enforces relational guards, atomic rollback and a shared concurrent request budget", async () => {
    const { org, orm, memberUser } = await withStage("relational-guards", async () => {
      const org = randomUUID();
      await db.prepare("INSERT INTO organization (id, name, slug) VALUES (?, 'Harness', ?)")
        .bind(org, `harness-${org}`).run();
      await expect(db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, 'missing', 'owner')")
        .bind(randomUUID(), org).run()).rejects.toThrow();
      await expect(db.prepare("INSERT INTO user (id, name, email) VALUES (NULL, 'Invalid', 'invalid@invalid.test')")
        .run()).rejects.toThrow();
      const { orm, statement } = createWorkspaceD1(db);
      const createdAt = new Date("2026-09-08T00:00:00.123Z");
      const [memberUser] = await orm.insert(user).values({
        name: "D1 Harness", email: "d1-harness@invalid.test", emailVerified: true, createdAt,
      }).returning();
      expect(memberUser.createdAt).toEqual(createdAt);
      expect(memberUser.emailVerified).toBe(true);
      expect(memberUser.id).toMatch(/^[a-f0-9-]{36}$/);
      const [integration] = await orm.insert(workspaceProviderIntegration).values({
        organizationId: org, provider: "neon", displayName: "Harness",
        externalAccountId: "harness-account", encryptedCredential: "harness-envelope", generation: 2n,
      }).returning();
      expect(integration.generation).toBe(2n);
      await expect(orm.update(workspaceProviderIntegration).set({ generation: 9007199254740992n }))
        .rejects.toThrow();
      expect(() => statement(sql`SELECT ${9007199254740992n}`)).toThrow();
      await expect(db.prepare("UPDATE workspace_provider_integration SET generation = 1.5").run())
        .rejects.toThrow();
      await expect(db.prepare("UPDATE user SET email_verified = 2").run()).rejects.toThrow();
      await expect(db.prepare("UPDATE user SET created_at = 'invalid'").run()).rejects.toThrow();
      return { org, orm, memberUser };
    });

    await withStage("workspace-mutations", async () => {
      await verifyDesktopAuthorization(db, memberUser.id);
      const { ensurePersonalKnowledgeScope } = await import("./knowledge/personal-scope");
      const sessionId = randomUUID();
      await db.prepare("INSERT INTO session (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)")
        .bind(sessionId, randomUUID(), memberUser.id, new Date(Date.now() + 60_000).toISOString()).run();
      const projection = {
        userId: memberUser.id, sessionId,
        projects: [{ id: randomUUID(), name: "Project", revision: 1,
          environments: [{ id: randomUUID(), kind: "development" as const, revision: 1 }] }],
      };
      const originalEnvironment = {
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      };
      try {
        process.env.BETTER_AUTH_URL = "https://workspace.dopedb.dev";
        process.env.BETTER_AUTH_SECRET = "d1-harness-session-secret-" + randomUUID();
        process.env.GOOGLE_CLIENT_ID = "d1-harness-google-client";
        process.env.GOOGLE_CLIENT_SECRET = "d1-harness-google-secret";
        const { getAuth } = await import("./auth");
        await verifyDesktopAuthorizationRoutes(memberUser.id);
        const token = await db.prepare("SELECT token FROM session WHERE id = ?").bind(sessionId).first<string>("token");
        const authenticated = await getAuth().api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
        expect(authenticated?.user.id).toBe(memberUser.id);
        // Pre-kind Desktops sync `{name, riskClass}`; it reads as the kind and `custom` is development.
        const { POST: syncPersonalScope } = await import("../app/api/v1/personal/knowledge/scope/route");
        const personalScopeRequest = (environments: unknown[]) => new Request("https://workspace.dopedb.dev/api/fixture", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ projects: [{ id: projection.projects[0].id, name: "Project", revision: 1, environments }] }),
        });
        const legacyEnvironment = { id: projection.projects[0].environments[0].id, name: "main", riskClass: "custom", revision: 1 };
        expect((await syncPersonalScope(personalScopeRequest([legacyEnvironment]))).status).toBe(200);
        expect(await db.prepare("SELECT kind || '/' || name || '/' || risk_class AS stored FROM knowledge_project_environment WHERE id = ?")
          .bind(legacyEnvironment.id).first("stored")).toBe("development/Development/development");
        expect((await syncPersonalScope(personalScopeRequest([{ id: legacyEnvironment.id, kind: "development", revision: 1 }]))).status).toBe(200);
        expect((await syncPersonalScope(personalScopeRequest([
          legacyEnvironment, { id: randomUUID(), kind: "development", revision: 1 },
        ]))).status).toBe(400);
        expect((await syncPersonalScope(personalScopeRequest([{ id: legacyEnvironment.id, kind: "custom", revision: 1 }]))).status).toBe(400);
        const organization = await getAuth().api.createOrganization({
          headers: new Headers({ authorization: `Bearer ${token}` }),
          body: { name: "D1 Workspace", slug: "d1-workspace" },
        });
        expect(organization?.id).toBeTruthy();
        expect(await db.prepare("SELECT count(*) AS count FROM workspace_profile WHERE organization_id = ?")
          .bind(organization!.id).first("count")).toBe(1);
      } finally {
        for (const [key, value] of Object.entries(originalEnvironment)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
      const first = await ensurePersonalKnowledgeScope(projection);
      expect(await ensurePersonalKnowledgeScope(projection)).toEqual(first);
      expect(await db.prepare("SELECT count(*) AS count FROM workspace_audit_event WHERE organization_id = ?")
        .bind(first.workspaceId).first("count")).toBe(1);
      const [installation] = await orm.insert(knowledgeGithubInstallation).values({
        organizationId: first.workspaceId, installationId: 101n, accountId: "101", accountLogin: "fixture",
      }).returning();
      const [source] = await orm.insert(knowledgeSource).values({
        organizationId: first.workspaceId, projectId: projection.projects[0].id,
        projectEnvironmentId: projection.projects[0].environments[0].id, environmentRevision: 1,
        provider: "github", displayName: "fixture/source", visibility: "shared_graph",
        githubInstallationId: installation.id, repositoryId: "1004", repositoryFullName: "fixture/source",
        refName: "main", commitSha: "6".repeat(40), syncState: "ready",
      }).returning();
      const { recordGithubSourceRevisions } = await import("./knowledge/source-revisions");
      const revision = { organizationId: first.workspaceId, sourceId: source.id, deliveryId: randomUUID(),
        beforeCommitSha: "6".repeat(40), afterCommitSha: "7".repeat(40) };
      expect(await recordGithubSourceRevisions([revision])).toEqual([
        { eventId: expect.any(String), sourceId: source.id, advanced: true },
      ]);
      expect(await recordGithubSourceRevisions([revision])).toEqual([]);
      expect(await recordGithubSourceRevisions([{ ...revision, deliveryId: randomUUID(), afterCommitSha: "8".repeat(40) }]))
        .toEqual([{ eventId: expect.any(String), sourceId: source.id, advanced: false }]);
      expect(await db.prepare("SELECT commit_sha FROM knowledge_source WHERE id = ?").bind(source.id).first("commit_sha"))
        .toBe("7".repeat(40));
      await verifyD1WorkspaceMutations(db, { ...first, userId: memberUser.id, sessionId });
      await db.prepare("UPDATE member SET revocation_pending_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), first.memberId).run();
      await expect(ensurePersonalKnowledgeScope({ ...projection,
        projects: [{ ...projection.projects[0], name: "Rejected mutation" }] })).rejects.toThrow();
      expect(await db.prepare("SELECT name FROM knowledge_project WHERE id = ?")
        .bind(projection.projects[0].id).first("name")).toBe("Project");
    });

    await withStage("atomic-rollback", async () => {
      const audit = randomUUID();
      await db.prepare(`INSERT INTO workspace_audit_event
        (id, organization_id, action, resource_type, resource_id, redacted_summary, request_id)
        VALUES (?, ?, 'connection.create', 'connection', 'fixture', '{}', ?)`)
        .bind(audit, org, randomUUID()).run();
      expect(await db.prepare("SELECT last_sequence FROM workspace_sync_head WHERE organization_id = ?")
        .bind(org).first("last_sequence")).toBe(1);
      expect(await db.prepare("SELECT audit_event_id FROM workspace_sync_event WHERE organization_id = ?")
        .bind(org).first("audit_event_id")).toBe(audit);
      await expect(db.batch([
        db.prepare("INSERT INTO rate_limit (id, key, count, last_request) VALUES ('rollback', 'rollback', 1, 1)"),
        db.prepare("INSERT INTO organization (id, name, slug) VALUES (?, 'Duplicate', ?)").bind(org, org),
      ])).rejects.toThrow();
      expect(await db.prepare("SELECT count(*) AS count FROM rate_limit WHERE id = 'rollback'")
        .first("count")).toBe(0);
      const guarded = await atomicD1({
        scope: sql`SELECT json_object('id', ${org}) AS payload FROM organization WHERE id = ${org}`,
        statements: (scope) => [sql`INSERT INTO rate_limit (id, key, count, last_request)
          SELECT 'guarded', 'guarded', 1, 1 FROM (${scope})`],
      }, db);
      expect(guarded.matched).toBe(true);
      expect(await db.prepare("SELECT count(*) AS count FROM workspace_atomic_scope").first("count")).toBe(0);
      const rejected = await atomicD1({
        scope: sql`SELECT '{}' AS payload FROM organization WHERE id = 'missing'`,
        statements: (scope) => [sql`INSERT INTO rate_limit (id, key, count, last_request)
          SELECT 'unguarded', 'unguarded', 1, 1 FROM (${scope})`],
      }, db);
      expect(rejected.matched).toBe(false);
      expect(await db.prepare("SELECT count(*) AS count FROM rate_limit WHERE id = 'unguarded'").first("count")).toBe(0);
      await expect(atomicD1({
        scope: sql`SELECT '{}' AS payload`,
        statements: (scope) => [sql`INSERT INTO organization (id, name, slug)
          SELECT ${org}, 'Duplicate', ${org} FROM (${scope})`],
      }, db)).rejects.toThrow();
      expect(await db.prepare("SELECT count(*) AS count FROM workspace_atomic_scope").first("count")).toBe(0);
    });

    await withStage("budget", async () => {
      const now = Date.now();
      const accepted = await Promise.all(Array.from({ length: 24 }, () => consumeD1Budget(db, {
        id: randomUUID(), key: "concurrent", now, cutoff: now - 60_000, limit: 7, cost: 1,
      })));
      expect(accepted.filter(Boolean)).toHaveLength(7);
      expect(await db.prepare("SELECT count FROM rate_limit WHERE key = 'concurrent'").first("count")).toBe(7);
    });

    await withStage("pattern-guards", async () => {
      const dialect = new SQLiteSyncDialect();
      const evaluate = async (expression: ReturnType<typeof matches>) => {
        const query = dialect.sqlToQuery(sql`SELECT ${expression} AS valid`);
        return await db.prepare(query.sql).bind(...query.params).first("valid");
      };
      for (const [pattern, values] of [
        ["^[0-9a-f]{64}$", ["a".repeat(64), "A".repeat(64), "a".repeat(63), "a".repeat(64) + "\n"]],
        ["^[a-z][a-z0-9-]{4,28}[a-z0-9]$", ["dopedb-project", "-opedb-project", "abcde", "dopedb-"]],
        ["^v1\\.[A-Za-z0-9_-]{43}$", ["v1." + "a".repeat(43), "v1X" + "a".repeat(43)]],
        ["^[A-Za-z0-9+/]+={0,2}$", ["ab+/==", "a=b", "===", "a===", "a"]],
      ] as const) {
        for (const value of values) {
          expect(await evaluate(matches(sql`${value}`, pattern)))
            .toBe(new RegExp(pattern).test(value) ? 1 : 0);
        }
      }
      for (const value of ["src/main.ts", "../main.ts", "src/../main.ts", "/main.ts", "a\\b", "a//b", "a/."]) {
        expect(await evaluate(safeRelativePath(sql`${value}`)))
          .toBe(value === "src/main.ts" ? 1 : 0);
      }
      expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
    });
  });
});
