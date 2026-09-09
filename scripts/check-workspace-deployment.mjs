// Match the uploaded version, the 100% Workers deployment, and the public domain.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cwd = fileURLToPath(new URL("../workspace-cloud", import.meta.url));
const productionOrigin = "https://app.dopedb.dev";

async function wrangler(...args) {
  const { stdout } = await run("pnpm", ["exec", "wrangler", ...args, "--json"], {
    cwd, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
  });
  const start = stdout.search(/^[\t ]*[\[{][\t ]*$/m);
  if (start < 0) throw new Error("Wrangler did not return a deployment receipt.");
  return JSON.parse(stdout.slice(start));
}

async function main() {
  const [versionId, ...extra] = process.argv.slice(2);
  if (extra.length || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(versionId || "")) {
    throw new Error("Usage: pnpm workspace:cloud:verify-deployment <worker-version-id>");
  }
  const version = await wrangler("versions", "view", versionId);
  if (version.id !== versionId) throw new Error("The requested Worker version is unavailable.");
  const deployments = await wrangler("deployments", "list");
  const current = deployments.toSorted((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  if (current?.versions?.length !== 1 || current.versions[0].version_id !== versionId
    || current.versions[0].percentage !== 100) {
    throw new Error("The requested version does not receive 100% of Workspace traffic.");
  }
  const response = await fetch(`${productionOrigin}/api/internal/deployment`, {
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("The production deployment receipt is unavailable.");
  const receipt = await response.json();
  if (receipt.service !== "dopedb-workspace" || receipt.versionId !== versionId) {
    throw new Error("The production domain still serves a different Workspace version.");
  }
  console.log(JSON.stringify({ status: "active", versionId, deploymentId: current.id,
    productionUrl: productionOrigin }, null, 2));
}

try { await main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "Workspace deployment verification failed.");
  process.exitCode = 1;
}
