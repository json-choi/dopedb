// Confirm the exact deployment reached Ready and owns the production domain.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cwd = fileURLToPath(new URL("../workspace-cloud", import.meta.url));
const productionDomain = "app.dopedb.dev";

async function inspect(reference, wait = false) {
  const args = ["inspect", reference, "--format=json"];
  if (wait) args.push("--wait", "--timeout", "3m");
  let output;
  try {
    ({ stdout: output } = await run("vercel", args, {
      cwd,
      timeout: 200_000,
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (error) {
    // Vercel returns nonzero for a failed deployment, with its receipt on stdout.
    output = error.stdout;
  }
  try {
    const receipt = JSON.parse(output);
    if (!receipt?.id || !receipt?.readyState) throw new Error();
    return receipt;
  } catch {
    throw new Error("Could not read the Vercel deployment receipt. Check the CLI login and project access.");
  }
}

function assertReady(receipt) {
  if (receipt.name !== "dopedb-workspace" || receipt.target !== "production") {
    throw new Error("The receipt is not a Workspace production deployment.");
  }
  if (receipt.readyState !== "READY") {
    const state = /^[A-Z_]+$/.test(receipt.readyState) ? receipt.readyState : "UNKNOWN";
    throw new Error(`Workspace deployment is ${state}; the production deployment has not succeeded.`);
  }
}

async function main() {
  const [reference, ...extra] = process.argv.slice(2);
  if (extra.length || !reference || !(
    /^dpl_[A-Za-z0-9]+$/.test(reference)
    || /^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(reference)
  )) {
    throw new Error("Usage: pnpm workspace:cloud:verify-deployment <new-deployment-url-or-id>");
  }
  const deployment = await inspect(reference, true);
  assertReady(deployment);
  const production = await inspect(`https://${productionDomain}`);
  assertReady(production);
  // Resolve the live domain directly: the deployment's stored aliases can omit
  // domains assigned later by `vercel promote`.
  if (production.id !== deployment.id) {
    throw new Error("The requested deployment is Ready, but app.dopedb.dev still serves a different deployment.");
  }
  console.log(JSON.stringify({
    status: "ready",
    deploymentId: deployment.id,
    deploymentUrl: deployment.url,
    productionUrl: `https://${productionDomain}`,
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
