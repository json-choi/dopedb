import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cwd = root;

async function command(file, args, options = {}) {
  return run(file, args, {
    cwd: options.cwd ?? cwd,
    env: process.env,
    timeout: options.timeout ?? 180_000,
    maxBuffer: 8 * 1024 * 1024,
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

  const head = await command("git", ["rev-parse", "HEAD"], { cwd: root });
  if (head.stdout.trim() !== commit) {
    throw new Error("The requested commit does not match the checked-out source.");
  }

  const configuration = JSON.parse(await readFile(new URL("../site/wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(configuration.name, "dopedb-site");
  assert.deepEqual(configuration.routes.map((route) => route.pattern).sort(), ["dopedb.dev", "www.dopedb.dev"]);

  const identityOutput = await command("pnpm", ["--dir", "site", "exec", "wrangler", "whoami", "--json"]);
  const identity = jsonFromWrangler(identityOutput.stdout);
  if (!identity.loggedIn || identity.accounts?.length !== 1
    || identity.accounts[0].id !== configuration.account_id) {
    throw new Error("The active Cloudflare identity does not match site/wrangler.jsonc.");
  }

  const built = await command("pnpm", ["--dir", "site", "build:cloudflare"]);
  process.stdout.write(built.stdout);
  process.stderr.write(built.stderr);
  const message = `git-${commit.slice(0, 8)}-site-ci`;
  const deployed = await command("pnpm", ["--dir", "site", "exec", "opennextjs-cloudflare", "deploy", "--message", message]);
  process.stdout.write(deployed.stdout);
  process.stderr.write(deployed.stderr);
  const versions = [...deployed.stdout.matchAll(/Current Version ID:\s+([a-f0-9-]{36})/g)];
  const versionId = versions.at(-1)?.[1];
  if (!versionId) throw new Error("Cloudflare did not report the uploaded site version.");

  const verified = await command("node", ["scripts/check-site-deployment.mjs", versionId], { cwd: root });
  process.stdout.write(verified.stdout);
  process.stderr.write(verified.stderr);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version-id=${versionId}\n`, "utf8");
  }
}

try { await main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "Site deployment failed.");
  process.exitCode = 1;
}
