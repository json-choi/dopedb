import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { matches, safeRelativePath } from "./d1/schema/patterns";
import { atomicD1 } from "./d1/atomic";
import { createWorkspaceD1 } from "./d1/database";
import { user, workspaceProviderIntegration, knowledgeGithubInstallation, knowledgeSource } from "./d1/schema";
import { consumeD1Budget } from "./d1/rate-limits";
import { verifyD1WorkspaceMutations } from "./d1-workspace-scenarios.harness";

const fixtureBinding = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { WORKSPACE_DB: fixtureBinding.value } }),
}));

describe("Workspace D1 safety", () => {
  it("enforces relational guards, atomic rollback and a shared concurrent request budget", async () => {
    const runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } };',
      compatibilityDate: "2026-09-08",
      d1Databases: ["DB"],
    }));
    try {
      const db = await runtime.getD1Database("DB");
      fixtureBinding.value = db;
      for (const name of ["0000_workspace_baseline.sql", "0001_workspace_guards.sql", "0002_storage_types.sql", "0003_atomic_scope.sql", "0004_member_evidence_detachment.sql", "0005_backup_chunks.sql", "0006_retention_purge.sql"]) {
        const source = await readFile(new URL(`../d1-migrations/${name}`, import.meta.url), "utf8");
        const statements = source.includes("--> statement-breakpoint")
          ? source.split("--> statement-breakpoint")
          : source.split(/(?=CREATE TRIGGER )/);
        for (const statement of statements) {
          const text = statement.replace(/^\s*--.*$/gm, "").trim();
          if (text) await db.exec(text.replace(/\r?\n/g, " "));
        }
      }
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
      {
        const { ensurePersonalKnowledgeScope } = await import("./knowledge/personal-scope");
        const sessionId = randomUUID();
        await db.prepare("INSERT INTO session (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)")
          .bind(sessionId, randomUUID(), memberUser.id, new Date(Date.now() + 60_000).toISOString()).run();
        const projection = {
          userId: memberUser.id, sessionId,
          projects: [{ id: randomUUID(), name: "Project", revision: 1,
            environments: [{ id: randomUUID(), name: "Development", riskClass: "development" as const, revision: 1 }] }],
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
          const token = await db.prepare("SELECT token FROM session WHERE id = ?").bind(sessionId).first<string>("token");
          const authenticated = await getAuth().api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
          expect(authenticated?.user.id).toBe(memberUser.id);
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
      }
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
      const now = Date.now();
      const accepted = await Promise.all(Array.from({ length: 24 }, () => consumeD1Budget(db, {
        id: randomUUID(), key: "concurrent", now, cutoff: now - 60_000, limit: 7, cost: 1,
      })));
      expect(accepted.filter(Boolean)).toHaveLength(7);
      expect(await db.prepare("SELECT count FROM rate_limit WHERE key = 'concurrent'").first("count")).toBe(7);
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
    } finally {
      fixtureBinding.value = null;
      await runtime.dispose();
    }
  }, 60_000);
});
