// Match the uploaded version, the 100% Workers deployment, and the public domain.
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { localBin } from "./local-command.mjs";

const run = promisify(execFile);
const site = fileURLToPath(new URL("../site", import.meta.url));
const productionOrigin = "https://dopedb.dev";

async function wrangler([command, ...prefix], ...args) {
  let stdout;
  try {
    ({ stdout } = await run(command, [...prefix, ...args, "--json"], {
      cwd: site, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    }));
  } catch (error) {
    // A child that never started reports an errno string instead of an exit status.
    if (typeof error?.code === "string") {
      throw new Error(`Site verification could not run ${command}: ${error.code}`);
    }
    throw new Error(`Site verification step failed (wrangler ${args[0]}), exit ${error?.code ?? "unknown"}`);
  }
  const start = stdout.search(/^[\t ]*[\[{][\t ]*$/m);
  if (start < 0) throw new Error("Wrangler did not return a deployment receipt.");
  return JSON.parse(stdout.slice(start));
}

async function activeReceipt(versionId, wranglerCommand) {
  const version = await wrangler(wranglerCommand, "versions", "view", versionId);
  if (version.id !== versionId) throw new Error("The requested site Worker version is unavailable.");

  const deployments = await wrangler(wranglerCommand, "deployments", "list");
  const current = deployments.toSorted((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  if (current?.versions?.length !== 1 || current.versions[0].version_id !== versionId
    || current.versions[0].percentage !== 100) {
    throw new Error("The requested version does not receive 100% of site traffic.");
  }

  const receiptUrl = new URL("/api/deployment", productionOrigin);
  receiptUrl.searchParams.set("expected", versionId);
  const response = await fetch(receiptUrl, {
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("The production site deployment receipt is unavailable.");
  const receipt = await response.json();
  if (receipt.service !== "dopedb-site" || receipt.versionId !== versionId) {
    throw new Error("The production domain still serves a different site version.");
  }
  return current;
}

async function main() {
  const [versionId, ...extra] = process.argv.slice(2);
  if (extra.length || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(versionId || "")) {
    throw new Error("Usage: pnpm site:cloud:verify-deployment <worker-version-id>");
  }

  // Resolve the pinned CLI once, so a missing executable fails with its own
  // diagnostic instead of being retried as a transient propagation delay.
  const wranglerCommand = localBin(site, "wrangler");
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const current = await activeReceipt(versionId, wranglerCommand);
      console.log(JSON.stringify({ status: "active", versionId, deploymentId: current.id,
        traffic: "100%", productionUrl: productionOrigin }, null, 2));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await delay(2_000);
    }
  }
  throw lastError;
}

try { await main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "Site deployment verification failed.");
  process.exitCode = 1;
}
