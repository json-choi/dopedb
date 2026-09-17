// Exercise the production migration entry point against a disposable workerd D1.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { localBin } from "./local-command.mjs";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const directory = await mkdtemp(resolve(tmpdir(), "dopedb-d1-fixture-"));
const env = { ...process.env, CI: "true", WORKSPACE_DEPLOYMENT_ENV: "production" };
for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) delete env[name];
function run(command, args, expected = 0) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  // A child that never started has no status and no streams to compare.
  if (result.error) assert.fail(`Cannot run ${command}: ${result.error.code ?? result.error.message}`);
  const output = String(result.stdout ?? "") + String(result.stderr ?? "");
  assert.equal(result.status, expected, output);
  return output;
}
const runLocal = ([command, ...prefix], args, expected = 0) => run(command, [...prefix, ...args], expected);
const wrangler = localBin(cwd, "wrangler");
const migrate = ["scripts/migrate-production.sh", "--local", "--persist-to", directory];
const query = (statement) => runLocal(wrangler, ["d1", "execute", "WORKSPACE_DB", "--local", "--persist-to", directory,
  "--command", statement, "--json"]);
try {
  run("bash", migrate);
  run("bash", migrate); // Exact receipt replay does not rebuild or reset anything.
  const check = run("node", ["scripts/migrate-d1.mjs", "--check", "--local", "--persist-to", directory]);
  assert.match(check, /0 pending/);
  const retiredTables = JSON.parse(query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'device_code'"));
  assert.deepEqual(retiredTables[0].results, []);
  query("UPDATE workspace_schema_migration SET sha256 = 'tampered' WHERE file = '0000_workspace_baseline.sql'");
  assert.match(run("bash", migrate, 1), /D1 migration bytes or ordering differ/);
  const unknown = resolve(directory, "unknown");
  runLocal(wrangler, ["d1", "execute", "WORKSPACE_DB", "--local", "--persist-to", unknown,
    "--command", "CREATE TABLE unexpected (id TEXT)", "--json"]);
  assert.match(run("bash", ["scripts/migrate-production.sh", "--local", "--persist-to", unknown], 1), /refusing automatic adoption or reset/);
  console.log("Production D1 migrations verified: fresh apply, exact replay, tampered receipts and unknown database rejection.");
  runLocal(localBin(cwd, "vitest"), ["run", "--config", "vitest.contracts.config.ts"]);
  console.log("Workspace D1 contract and atomic mutation harness passed.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
