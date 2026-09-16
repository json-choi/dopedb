// Deploy the exact checked-out site revision with pinned project tools, then
// require a production-domain receipt for the uploaded Worker version.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, appendFile, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
const maximumOutput = 8 * 1024 * 1024;

class CommandFailure extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

function safeCommandName(command) {
  return basename(command).replace(/\.cmd$/iu, "");
}

export function runCommand([command, ...args], options = {}) {
  const cwd = options.cwd ?? defaultRoot;
  const env = options.env ?? process.env;
  const step = options.step ?? args[0] ?? safeCommandName(command);
  return new Promise((resolveCommand, rejectCommand) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timeout;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectCommand(error);
    };
    timeout = setTimeout(() => {
      child.kill();
      rejectOnce(new CommandFailure(
        `Site deployment step ${step} timed out.`,
        { kind: "timeout" },
      ));
    }, options.timeout ?? 180_000);
    const collect = (stream, chunk) => {
      const next = stream + chunk;
      if (next.length > maximumOutput) {
        child.kill();
        rejectOnce(new CommandFailure(
          `Site deployment step ${step} exceeded its bounded output buffer.`,
          { kind: "output" },
        ));
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk); });
    // A child that never started emits `error` before `close`; settle here so
    // the later close event cannot replace the actionable errno with an exit.
    child.once("error", (error) => rejectOnce(new CommandFailure(
      `Site deployment step ${step} could not start ${safeCommandName(command)}: ${error.code ?? error.message}`,
      { kind: "spawn", code: error.code },
    )));
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        rejectOnce(new CommandFailure(
          `Site deployment step ${step} failed (${safeCommandName(command)}), ${code === null ? `signal ${signal ?? "unknown"}` : `exit ${code}`}.`,
          { kind: "exit", code, signal },
        ));
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolveCommand({ stdout, stderr });
    });
  });
}

async function pinnedLocalBinary(directory, name) {
  const command = join(
    directory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${name}.CMD` : name,
  );
  try {
    await access(command, process.platform === "win32" ? constants.F_OK : constants.X_OK);
  } catch {
    throw new Error(`The pinned site binary ${name} is unavailable; install site dependencies first.`);
  }
  return [command];
}

function packageManagerPin(manifest) {
  const match = /^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$/u.exec(manifest.packageManager ?? "");
  if (!match) throw new Error("site/package.json must pin an exact pnpm version.");
  return match[1];
}

async function packageManager(directory, env, run) {
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const expected = packageManagerPin(manifest);
  const attempts = [];
  for (const candidate of [["pnpm"], ["corepack", "pnpm"]]) {
    const label = candidate.join(" ");
    try {
      const result = await run([...candidate, "--version"], {
        cwd: directory,
        env,
        step: `${label} version check`,
      });
      const actual = result.stdout.trim();
      if (actual === expected) return candidate;
      attempts.push(`${label}: version ${actual || "unknown"}`);
    } catch (error) {
      if (error instanceof CommandFailure) {
        attempts.push(`${label}: ${error.details.kind === "spawn" ? (error.details.code ?? "could not start") : `exit ${error.details.code ?? "unknown"}`}`);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`No package runner matches the site pin pnpm@${expected} (${attempts.join("; ")}).`);
}

async function packageScript(directory, name, env, run) {
  return [...await packageManager(directory, env, run), "run", name];
}

function jsonFromWrangler(stdout) {
  const start = stdout.search(/^[\t ]*[\[{][\t ]*$/m);
  if (start < 0) throw new Error("Wrangler did not return an identity receipt.");
  return JSON.parse(stdout.slice(start));
}

export async function deploySite(options = {}) {
  const root = options.root ?? defaultRoot;
  const site = join(root, "site");
  const env = options.env ?? process.env;
  const run = options.run ?? runCommand;
  const writeStdout = options.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr = options.writeStderr ?? ((value) => process.stderr.write(value));
  const [flag, commit, ...extra] = options.args ?? process.argv.slice(2);
  if (flag !== "--commit" || extra.length || !/^[a-f0-9]{40}$/.test(commit || "")) {
    throw new Error("Usage: pnpm site:cloud:deploy --commit <40-character-git-sha>");
  }
  if (env.CI === "true" && !env.CLOUDFLARE_API_TOKEN) {
    throw new Error("CLOUDFLARE_API_TOKEN must be provided by the site-production environment.");
  }

  const head = await run(["git", "rev-parse", "HEAD"], { cwd: root, env, step: "git rev-parse HEAD" });
  if (head.stdout.trim() !== commit) {
    throw new Error("The requested commit does not match the checked-out source.");
  }

  const configuration = JSON.parse(await readFile(join(site, "wrangler.jsonc"), "utf8"));
  assert.equal(configuration.name, "dopedb-site");
  assert.deepEqual(configuration.routes.map((route) => route.pattern).sort(), ["dopedb.dev", "www.dopedb.dev"]);

  const identityOutput = await run([...await pinnedLocalBinary(site, "wrangler"), "whoami", "--json"], {
    cwd: site,
    env,
    step: "wrangler whoami",
  });
  const identity = jsonFromWrangler(identityOutput.stdout);
  if (!identity.loggedIn || identity.accounts?.length !== 1
    || identity.accounts[0].id !== configuration.account_id) {
    throw new Error("The active Cloudflare identity does not match site/wrangler.jsonc.");
  }

  const built = await run(await packageScript(site, "build:cloudflare", env, run), {
    cwd: site,
    env,
    step: "build:cloudflare",
  });
  writeStdout(built.stdout);
  writeStderr(built.stderr);
  const message = `git-${commit.slice(0, 8)}-site-ci`;
  const deployed = await run([
    ...await pinnedLocalBinary(site, "opennextjs-cloudflare"),
    "deploy",
    "--message",
    message,
  ], { cwd: site, env, step: "opennextjs-cloudflare deploy" });
  writeStdout(deployed.stdout);
  writeStderr(deployed.stderr);
  const versions = [...deployed.stdout.matchAll(/Current Version ID:\s+([a-f0-9-]{36})/g)];
  const versionId = versions.at(-1)?.[1];
  if (!versionId) throw new Error("Cloudflare did not report the uploaded site version.");

  const verified = await run([process.execPath, join(root, "scripts", "check-site-deployment.mjs"), versionId], {
    cwd: root,
    env,
    step: "check-site-deployment",
  });
  writeStdout(verified.stdout);
  writeStderr(verified.stderr);
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `version-id=${versionId}\n`, "utf8");
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    await deploySite();
  } catch (error) {
    // Never print command environments, output bodies, or credential values.
    console.error(error instanceof Error ? error.message : "Site deployment failed.");
    process.exitCode = 1;
  }
}
