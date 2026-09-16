// Confirm the exact commit and Cloudflare account, build the site, deploy it,
// then verify the public domain serves that exact Worker version.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { localBin, nodeScript, packageScript } from "./local-command.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const site = fileURLToPath(new URL("../site", import.meta.url));

function run([command, ...args], { cwd = root, capture = false, timeout = 180_000, step } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env: process.env, timeout,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (output.length > 8 * 1024 * 1024) {
        child.kill();
        reject(new Error(`Site deployment step ${step} exceeded its bounded receipt buffer.`));
      }
    });
    // A child that never started reports no exit code, only this error.
    child.once("error", (error) => reject(new Error(
      `Site deployment step ${step} could not run ${command}: ${error.code ?? error.message}`)));
    child.once("close", (code, signal) => {
      if (signal) reject(new Error(`Site deployment step ${step} was terminated by ${signal}.`));
      else if (code === 0) resolve(output);
      else reject(new Error(`Site deployment step failed (${step}), exit ${code}`));
    });
  });
}

function jsonFromWrangler(stdout) {
  const start = stdout.search(/^[\t ]*[\[{][\t ]*$/m);
  if (start < 0) throw new Error("Wrangler did not return an identity receipt.");
  return JSON.parse(stdout.slice(start));
}

async function main() {
  const [flag, commit, ...extra] = process.argv.slice(2);
  if (flag !== "--commit" || extra.length || !/^[a-f0-9]{40}$/.test(commit || "")) {
    throw new Error("Usage: pnpm site:cloud:deploy --commit <40-character-git-sha>");
  }
  if (process.env.CI === "true" && !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("CLOUDFLARE_API_TOKEN must be provided by the site-production environment.");
  }

  const head = await run(["git", "rev-parse", "HEAD"], { capture: true, step: "git rev-parse" });
  if (head.trim() !== commit) {
    throw new Error("The requested commit does not match the checked-out source.");
  }

  const configuration = JSON.parse(await readFile(new URL("../site/wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(configuration.name, "dopedb-site");
  assert.deepEqual(configuration.routes.map((route) => route.pattern).sort(), ["dopedb.dev", "www.dopedb.dev"]);

  const identityOutput = await run([...localBin(site, "wrangler"), "whoami", "--json"],
    { cwd: site, capture: true, step: "wrangler whoami" });
  const identity = jsonFromWrangler(identityOutput);
  if (!identity.loggedIn || identity.accounts?.length !== 1
    || identity.accounts[0].id !== configuration.account_id) {
    throw new Error("The active Cloudflare identity does not match site/wrangler.jsonc.");
  }

  await run(packageScript("build:cloudflare"), { cwd: site, step: "build:cloudflare" });
  const message = `git-${commit.slice(0, 8)}-site-ci`;
  const deployed = await run([...localBin(site, "opennextjs-cloudflare"), "deploy", "--message", message],
    { cwd: site, capture: true, step: "opennextjs-cloudflare deploy" });
  process.stdout.write(deployed);
  const versions = [...deployed.matchAll(/Current Version ID:\s+([a-f0-9-]{36})/g)];
  const versionId = versions.at(-1)?.[1];
  if (!versionId) throw new Error("Cloudflare did not report the uploaded site version.");

  await run(nodeScript("scripts/check-site-deployment.mjs", versionId), { step: "check-site-deployment" });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version-id=${versionId}\n`, "utf8");
  }
}

try { await main(); } catch (error) {
  // Never print command environments, HTTP bodies, or credential values.
  console.error(error instanceof Error ? error.message : "Site deployment failed.");
  process.exitCode = 1;
}
