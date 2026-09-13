import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  validateHarnessEnvironment,
  validateHarnessSourceTree,
} from "./provider-import-postgres-harness-guard.mjs";
import { localBin } from "./local-command.mjs";

const workspaceCloudDirectory = fileURLToPath(new URL("..", import.meta.url));

try {
  validateHarnessSourceTree(workspaceCloudDirectory);
} catch {
  console.error("Refusing PostgreSQL harness: source safety guard failed.");
  process.exit(2);
}
try {
  validateHarnessEnvironment(process.env);
} catch {
  console.error(
    "Refusing PostgreSQL harness: independently provisioned test database verification failed.",
  );
  process.exit(2);
}

if (process.argv.includes("--check-guard-only")) process.exit(0);

const [command, ...prefix] = localBin(workspaceCloudDirectory, "vitest");
const result = spawnSync(
  command,
  [
    ...prefix,
    "run",
    "--config",
    "vitest.provider-harness.config.ts",
  ],
  {
    cwd: workspaceCloudDirectory,
    env: {
      ...process.env,
      BETTER_AUTH_URL: "https://dopedb.invalid",
      WORKSPACE_CLOUD_RUN_POSTGRES_IMPORT_HARNESS: "1",
    },
    stdio: "inherit",
  },
);
// A child that never started has no status to report.
if (result.error) {
  console.error(`PostgreSQL harness could not run ${command}: ${result.error.code ?? result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
