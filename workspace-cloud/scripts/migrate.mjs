// Validate the deployed migration lineage before applying the current baseline.
// Diagnostics never include connection URLs, SQL parameters, or database rows.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationConfig = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsSchema: "drizzle",
  migrationsTable: "__drizzle_migrations",
};

class MigrationPreflightError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function inspectWorkspaceMigrationState(sql) {
  const migrations = readMigrationFiles(migrationConfig);
  if (migrations.length === 0) {
    throw new MigrationPreflightError("MIGRATION_FILES_MISSING", "No Workspace migrations were found.");
  }
  const [state] = await sql`
    SELECT to_regnamespace('workspace_control') IS NOT NULL AS schema_exists,
      to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS journal_exists
  `;
  const applied = state.journal_exists
    ? await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id LIMIT 1001`
    : [];
  if (state.schema_exists && applied[0]?.hash !== migrations[0].hash) {
    throw new MigrationPreflightError(
      "MIGRATION_BASELINE_MISMATCH",
      "The existing Workspace database does not use this migration baseline. "
        + "Deployment stopped before schema changes. Review the database recovery plan; "
        + "do not reset data or mark the baseline as applied automatically.",
    );
  }
  if (!state.schema_exists && applied.length > 0) {
    throw new MigrationPreflightError("MIGRATION_SCHEMA_MISSING", "Migration history exists but the Workspace schema is missing.");
  }
  if (applied.length > migrations.length || applied.some((entry, index) => (
    entry.hash !== migrations[index].hash
    || Number(entry.created_at) !== migrations[index].folderMillis
  ))) {
    throw new MigrationPreflightError(
      "MIGRATION_HISTORY_MISMATCH",
      "The applied Workspace migration history differs from the checked-in files. Deployment stopped before schema changes.",
    );
  }
  return { applied: applied.length, pending: migrations.length - applied.length };
}

function reportFailure(error) {
  if (error instanceof MigrationPreflightError) {
    console.error(`Workspace migration failed [${error.code}]: ${error.message}`);
    return;
  }
  const code = error?.cause?.code ?? error?.code;
  const safeCode = typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)
    ? ` [${code}]`
    : "";
  console.error(`Workspace migration failed${safeCode}. Database details were withheld; inspect the database server diagnostics.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
    console.error("Usage: node scripts/migrate.mjs [--check]");
    process.exitCode = 1;
    return;
  }
  const checkOnly = args[0] === "--check";
  let sql;
  try {
    const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
    if (!url?.trim()) {
      throw new MigrationPreflightError("DATABASE_URL_REQUIRED", "Configure a Workspace database connection before running migrations.");
    }
    sql = postgres(url, {
      max: 1,
      connect_timeout: 15,
      onnotice: () => {},
      connection: {
        application_name: "dopedb-workspace-migrations",
        lock_timeout: 15_000,
        ...(checkOnly ? { default_transaction_read_only: "on", statement_timeout: 15_000 } : {}),
      },
    });
    if (!checkOnly) {
      await sql`SELECT pg_advisory_lock(hashtextextended('dopedb:workspace-migrations', 0))`;
    }
    const state = await inspectWorkspaceMigrationState(sql);
    console.log(`Workspace migration preflight passed: ${state.applied} applied, ${state.pending} pending.`);
    if (!checkOnly) {
      await migrate(drizzle(sql), migrationConfig);
      console.log("Workspace migrations applied successfully.");
    }
  } catch (error) {
    reportFailure(error);
    process.exitCode = 1;
  } finally {
    if (sql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
