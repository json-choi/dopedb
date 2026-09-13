// Vitest setup for the isolated PostgreSQL provider-import harness. The control
// plane these scenarios drive now writes through D1, so the suite needs a real
// D1 binding beside its isolated PostgreSQL database. Miniflare supplies a
// disposable workerd-backed D1 with the checked-in production migrations
// applied, so no hand-written fake schema is involved; the PostgreSQL side is
// untouched and still comes from the independently provisioned test database.
// This sits beside lib/provider-import-postgres-harness/ rather than inside it
// because validateHarnessSourceTree requires that directory's .ts files to
// match its manifest exactly. It is still ratchet-counted, through its own
// entry in PROVIDER_IMPORT_POSTGRES_HARNESS_SOURCE_LIMITS.
import { readFile, readdir } from "node:fs/promises";

import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, vi } from "vitest";

const fixtureBinding = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { WORKSPACE_DB: fixtureBinding.value } }),
}));

const migrationsDirectory = new URL("../d1-migrations/", import.meta.url);
let runtime: Miniflare | undefined;

beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("harness"); } };',
    compatibilityDate: "2026-09-08",
    d1Databases: ["DB"],
  }));
  const database = await runtime.getD1Database("DB");
  fixtureBinding.value = database;

  // Apply every checked-in migration in lexical order, matching
  // scripts/migrate-d1.mjs, so the harness sees the production schema.
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (migrations.length === 0) {
    throw new Error("Workspace D1 migrations are missing for the PostgreSQL harness");
  }
  for (const name of migrations) {
    const source = await readFile(new URL(name, migrationsDirectory), "utf8");
    const statements = source.includes("--> statement-breakpoint")
      ? source.split("--> statement-breakpoint")
      : source.split(/(?=CREATE TRIGGER )/);
    for (const statement of statements) {
      const text = statement.replace(/^\s*--.*$/gm, "").trim();
      if (text) await database.exec(text.replace(/\r?\n/g, " "));
    }
  }
});

afterAll(async () => {
  fixtureBinding.value = null;
  await runtime?.dispose();
});
